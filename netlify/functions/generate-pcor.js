const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

function formatDate(dateString) {
  if (!dateString) return {};
  const date = new Date(dateString);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const year = date.getFullYear().toString();
  return { month, day, year, full: month + '/' + day + '/' + year };
}

function formatCurrency(value) {
  if (!value) return "";
  const num = parseFloat(value.toString().replace(/[^0-9.-]/g, ''));
  return num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

async function loadPDFTemplate(county) {
  const fetch = (await import('node-fetch')).default;
  
  const templateMap = {
    'los-angeles': 'preliminary-change-of-ownership%20(1).pdf',
    'ventura': 'VENTURA%20County%20Form%20BOE-502-A%20for%202022%20(14).pdf',
    'orange': 'ORANGE%20County%20Form%20BOE-502-A%20for%202021%20(18).pdf',
    'san-bernardino': 'SAN_BERNARDINO%20County%20Form%20BOE-502-A%20for%202025%20(23).pdf',
    'riverside': 'RIVERSIDE%20County%20Form%20BOE-502-A%20for%202018%20(6).pdf'
  };
  
  const templateFile = templateMap[county];
  if (!templateFile) {
    throw new Error('Unknown county: ' + county);
  }
  
  const url = `https://pcorautomation.netlify.app/templates/${templateFile}`;
  
  try {
    console.log('Loading template for ' + county + ' from: ' + url);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to load template: ' + response.statusText);
    }
    const buffer = await response.buffer();
    console.log('Successfully loaded template (' + buffer.length + ' bytes)');
    return buffer;
  } catch (error) {
    console.error('Error loading template for ' + county + ':', error);
    throw error;
  }
}

async function fillPCORForm(data, pdfBytes, county) {
  try {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    
    console.log('Form has ' + fields.length + ' fields');
    
    // Get all checkboxes - using includes to catch PDFCheckBox2 and PDFCheckBox
    const allCheckboxes = fields.filter(field => field.constructor.name.includes('PDFCheckBox'));
    console.log('Found ' + allCheckboxes.length + ' checkboxes');
    
    const dateInfo = formatDate(data.transferDate);
    
    // Build complete addresses
    const buyerFullAddress = data.buyerAddress ? 
      `${data.buyerAddress}\n${data.buyerCity || ''}, ${data.buyerState || 'CA'} ${data.buyerZip || ''}` : '';
    
    const propertyFullAddress = data.propertyAddress ? 
      `${data.propertyAddress}, ${data.propertyCity || ''}, ${data.propertyState || 'CA'} ${data.propertyZip || ''}` : '';
    
    // Text field mappings
    const fieldMappings = {
      'NAME AND MAILING ADDRESS OF BUYER/TRANSFEREE': `${data.buyerName}\n${buyerFullAddress}`,
      'Name and mailing address of buyer/transferee': `${data.buyerName}\n${buyerFullAddress}`,
      'ASSESSOR\'S PARCEL NUMBER': data.apn,
      'Assessors parcel number': data.apn,
      'SELLER/TRANSFEROR': data.sellerName,
      'seller transferor': data.sellerName,
      'BUYER\'S DAYTIME TELEPHONE NUMBER': data.buyerPhone,
      'buyer\'s daytime telephone number1': data.buyerPhone,
      'BUYER\'S EMAIL ADDRESS': data.buyerEmail,
      'Buyer\'s email address': data.buyerEmail,
      'STREET ADDRESS OR PHYSICAL LOCATION OF REAL PROPERTY': propertyFullAddress,
      'street address or physical location of real property': propertyFullAddress,
      'MO': dateInfo.month,
      'Month': dateInfo.month,
      'DAY': dateInfo.day,
      'day': dateInfo.day,
      'YEAR': dateInfo.year,
      'year': dateInfo.year,
      'MAIL PROPERTY TAX INFORMATION TO (NAME)': data.buyerName,
      'mail property tax information to (name)': data.buyerName,
      'MAIL PROPERTY TAX INFORMATION TO (ADDRESS)': data.mailingAddress || data.buyerAddress,
      'Mail property tax informatino to address': data.mailingAddress || data.buyerAddress,
      'CITY': data.mailingCity || data.buyerCity || data.propertyCity,
      'city': data.mailingCity || data.buyerCity || data.propertyCity,
      'STATE': data.mailingState || data.buyerState || 'CA',
      'state': data.mailingState || data.buyerState || 'CA',
      'ZIP CODE': data.mailingZip || data.buyerZip || data.propertyZip,
      'ZIP code': data.mailingZip || data.buyerZip || data.propertyZip,
      'Name of buyer/transferee/personal representative/corporate officer (please print)': data.buyerName + ' as Trustor/Trustee',
      'title': 'Trustor/Trustee',
    };
    
    // Fill text fields
    for (const [fieldName, value] of Object.entries(fieldMappings)) {
      if (value) {
        try {
          const field = form.getTextField(fieldName);
          field.setText(value.toString());
        } catch (e) {
          const foundField = fields.find(field => {
            const name = field.getName();
            return name && name.toLowerCase() === fieldName.toLowerCase() && 
                   field.constructor.name.includes('TextField');
          });
          
          if (foundField) {
            try {
              const textField = form.getTextField(foundField.getName());
              textField.setText(value.toString());
            } catch (e2) {}
          }
        }
      }
    }
    
    // CHECKBOX HANDLING
    console.log('Checking appropriate checkboxes...');
    
    // List checkbox names for debugging
    console.log('First 30 checkbox names:');
    for (let i = 0; i < Math.min(30, allCheckboxes.length); i++) {
      console.log(`[${i}]: ${allCheckboxes[i].getName()}`);
    }
    
    // Check NO for principal residence (checkbox at index 1)
    if (allCheckboxes.length > 1) {
      try {
        const checkboxName = allCheckboxes[1].getName();
        const checkbox = form.getCheckBox(checkboxName);
        checkbox.check();
        console.log('✓ Checked NO for Principal Residence (index 1)');
      } catch (e) {
        console.log('✗ Could not check Principal Residence NO: ' + e.message);
      }
    }
    
    // Check NO for disabled veteran (checkbox at index 3)  
    if (allCheckboxes.length > 3) {
      try {
        const checkboxName = allCheckboxes[3].getName();
        const checkbox = form.getCheckBox(checkboxName);
        checkbox.check();
        console.log('✓ Checked NO for Disabled Veteran (index 3)');
      } catch (e) {
        console.log('✗ Could not check Disabled Veteran NO: ' + e.message);
      }
    }
    
    // Section L - Check YES (try multiple possible indices)
    // L1 is typically around index 48-52 in the form
    const sectionLIndices = [48, 49, 50, 51, 52, 53, 54];
    let foundSectionL = false;
    
    for (const idx of sectionLIndices) {
      if (idx < allCheckboxes.length && !foundSectionL) {
        const checkboxName = allCheckboxes[idx].getName();
        
        // Check if this is section L (revocable trust)
        if (checkboxName && (
            checkboxName.toLowerCase().includes('l1') ||
            checkboxName.toLowerCase().includes('revocable') ||
            checkboxName.toLowerCase().includes('trust') ||
            idx === 50  // Often L1 is exactly at index 50
        )) {
          try {
            const checkbox = form.getCheckBox(checkboxName);
            checkbox.check();
            console.log(`✓ Checked YES for Section L1 at index ${idx}`);
            foundSectionL = true;
          } catch (e) {
            console.log(`✗ Could not check Section L at index ${idx}: ${e.message}`);
          }
        }
      }
    }
    
    // If not found by search, try index 50 directly (common position for L1)
    if (!foundSectionL && allCheckboxes.length > 50) {
      try {
        const checkboxName = allCheckboxes[50].getName();
        const checkbox = form.getCheckBox(checkboxName);
        checkbox.check();
        console.log('✓ Checked Section L1 at default index 50');
      } catch (e) {
        console.log('✗ Could not check Section L1 at index 50');
      }
    }
    
    const pdfBytesResult = await pdfDoc.save();
    return pdfBytesResult;
    
  } catch (error) {
    console.error('Error filling PCOR form:', error);
    throw error;
  }
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }
  
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }
  
  try {
    const data = JSON.parse(event.body);
    console.log('Received PCOR data for county:', data.county);
    
    // Ensure we have complete address data
    if (!data.buyerAddress && data.propertyAddress) {
      data.buyerAddress = data.propertyAddress;
      data.buyerCity = data.propertyCity;
      data.buyerState = data.propertyState || 'CA';
      data.buyerZip = data.propertyZip;
    }
    
    const pdfBytes = await loadPDFTemplate(data.county);
    const filledPdfBytes = await fillPCORForm(data, pdfBytes, data.county);
    
    const base64 = Buffer.from(filledPdfBytes).toString('base64');
    const dataUrl = 'data:application/pdf;base64,' + base64;
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        pdfUrl: dataUrl,
        message: 'PCOR form generated successfully'
      })
    };
  } catch (error) {
    console.error('Error generating PCOR:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to generate PCOR form',
        details: error.message
      })
    };
  }
};
