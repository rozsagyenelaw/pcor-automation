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
    
    console.log('Form has ' + fields.length + ' fields available');
    
    // Get all checkboxes for indexed access
    const allCheckboxes = fields.filter(field => field.constructor.name === 'PDFCheckBox');
    console.log('Total checkboxes found: ' + allCheckboxes.length);
    
    // Log all checkbox names for debugging
    console.log('Checkbox field names:');
    allCheckboxes.forEach((cb, index) => {
      console.log(`  [${index}]: ${cb.getName()}`);
    });
    
    const dateInfo = formatDate(data.transferDate);
    
    // Build complete addresses
    const buyerFullAddress = data.buyerAddress ? 
      `${data.buyerAddress}\n${data.buyerCity || ''}, ${data.buyerState || 'CA'} ${data.buyerZip || ''}` : '';
    
    const propertyFullAddress = data.propertyAddress ? 
      `${data.propertyAddress}, ${data.propertyCity || ''}, ${data.propertyState || 'CA'} ${data.propertyZip || ''}` : '';
    
    // Text field mappings
    const fieldMappings = {
      // Top section - Buyer name and address (combined field)
      'NAME AND MAILING ADDRESS OF BUYER/TRANSFEREE': `${data.buyerName}\n${buyerFullAddress}`,
      'Name and mailing address of buyer/transferee': `${data.buyerName}\n${buyerFullAddress}`,
      
      // APN
      'ASSESSOR\'S PARCEL NUMBER': data.apn,
      'Assessors parcel number': data.apn,
      
      // Seller
      'SELLER/TRANSFEROR': data.sellerName,
      'seller transferor': data.sellerName,
      
      // Contact Information
      'BUYER\'S DAYTIME TELEPHONE NUMBER': data.buyerPhone,
      'buyer\'s daytime telephone number1': data.buyerPhone,
      
      'BUYER\'S EMAIL ADDRESS': data.buyerEmail,
      'Buyer\'s email address': data.buyerEmail,
      
      // Property Address
      'STREET ADDRESS OR PHYSICAL LOCATION OF REAL PROPERTY': propertyFullAddress,
      'street address or physical location of real property': propertyFullAddress,
      
      // Date fields
      'MO': dateInfo.month,
      'Month': dateInfo.month,
      'DAY': dateInfo.day,
      'day': dateInfo.day,
      'YEAR': dateInfo.year,
      'year': dateInfo.year,
      
      // Mail Property Tax To section
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
      
      // Page 2 - Signature Section (minimal)
      'Name of buyer/transferee/personal representative/corporate officer (please print)': data.buyerName + ' as Trustor/Trustee',
      'title': 'Trustor/Trustee',
    };
    
    // Fill text fields
    for (const [fieldName, value] of Object.entries(fieldMappings)) {
      if (value) {
        try {
          const field = form.getTextField(fieldName);
          field.setText(value.toString());
          console.log('✓ Set field "' + fieldName + '"');
        } catch (e) {
          // Try case-insensitive
          const foundField = fields.find(field => {
            const name = field.getName();
            return name && name.toLowerCase() === fieldName.toLowerCase() && 
                   field.constructor.name.includes('TextField');
          });
          
          if (foundField) {
            try {
              const textField = form.getTextField(foundField.getName());
              textField.setText(value.toString());
              console.log('✓ Set field "' + foundField.getName() + '"');
            } catch (e2) {
              console.log('✗ Could not set field: ' + fieldName);
            }
          }
        }
      }
    }
    
    // CHECKBOX HANDLING - HARDCODED FOR YOUR SPECIFIC NEEDS
    // Based on your requirement: All NO except Section L is YES
    
    try {
      // For most PCOR forms, the checkboxes are in this order:
      // [0-1]: Principal residence (YES/NO)
      // [2-3]: Disabled veteran (YES/NO) 
      // [4-5]: Section A (YES/NO)
      // [6-7]: Section B (YES/NO)
      // ... and so on
      
      // Principal Residence - Check NO (index 1)
      if (allCheckboxes.length > 1) {
        try {
          const cb = form.getCheckBox(allCheckboxes[1].getName());
          cb.check();
          console.log('✓ Checked NO for Principal Residence');
        } catch (e) {
          console.log('✗ Could not check Principal Residence NO');
        }
      }
      
      // Disabled Veteran - Check NO (index 3)
      if (allCheckboxes.length > 3) {
        try {
          const cb = form.getCheckBox(allCheckboxes[3].getName());
          cb.check();
          console.log('✓ Checked NO for Disabled Veteran');
        } catch (e) {
          console.log('✗ Could not check Disabled Veteran NO');
        }
      }
      
      // Section L - This is usually around index 22-26 depending on the form
      // Look for checkbox related to trust/revocable trust
      // Try multiple indices where Section L might be
      const sectionLIndices = [22, 23, 24, 25, 26, 27, 28];
      let sectionLFound = false;
      
      for (const idx of sectionLIndices) {
        if (idx < allCheckboxes.length && !sectionLFound) {
          const checkboxName = allCheckboxes[idx].getName();
          // Check if this might be Section L (trust-related)
          if (checkboxName && (
              checkboxName.toLowerCase().includes('trust') ||
              checkboxName.toLowerCase().includes('revocable') ||
              checkboxName.toLowerCase().includes('l1') ||
              checkboxName.toLowerCase().includes('section l')
          )) {
            try {
              const cb = form.getCheckBox(checkboxName);
              cb.check();
              console.log(`✓ Checked Section L at index ${idx}: "${checkboxName}"`);
              sectionLFound = true;
            } catch (e) {
              console.log(`✗ Could not check Section L at index ${idx}`);
            }
          }
        }
      }
      
      // If Section L not found by name, try by position (usually around checkbox 24-26)
      if (!sectionLFound && allCheckboxes.length > 24) {
        try {
          const cb = form.getCheckBox(allCheckboxes[24].getName());
          cb.check();
          console.log('✓ Checked Section L by position (index 24)');
        } catch (e) {
          console.log('✗ Could not check Section L by position');
        }
      }
      
      // Alternative: Check specific known checkbox names for Section L
      const sectionLNames = [
        'L1. This is a transfer of property to/from a revocable trust that may be revoked by the transferor and is for the benefit of the transferor and/or the transferor\'s spouse and/or registered domestic partner',
        'L1. This is a transfer of property to/from a revocable trust that may be revoked by the transferor and is for the benefit of',
        'Check Box25',
        'Check Box26',
        'YES_L1',
        'L1'
      ];
      
      for (const name of sectionLNames) {
        try {
          const cb = form.getCheckBox(name);
          cb.check();
          console.log(`✓ Checked Section L by name: "${name}"`);
          break;
        } catch (e) {
          // This name didn't match
        }
      }
      
    } catch (error) {
      console.error('Error in checkbox handling:', error);
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
    console.log('Form data:', data);
    
    // Ensure we have complete address data
    if (!data.buyerAddress && data.propertyAddress) {
      data.buyerAddress = data.propertyAddress;
      data.buyerCity = data.propertyCity;
      data.buyerState = data.propertyState || 'CA';
      data.buyerZip = data.propertyZip;
    }
    
    const pdfBytes = await loadPDFTemplate(data.county);
    console.log('PDF template loaded successfully');
    
    const filledPdfBytes = await fillPCORForm(data, pdfBytes, data.county);
    console.log('PDF form filled successfully');
    
    const base64 = Buffer.from(filledPdfBytes).toString('base64');
    const dataUrl = 'data:application/pdf;base64,' + base64;
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        pdfUrl: dataUrl,
        message: 'PCOR form for ' + data.county + ' generated successfully'
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
