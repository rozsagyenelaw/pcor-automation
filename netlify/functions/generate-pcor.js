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
    
    console.log('=== COMPLETE FIELD ANALYSIS ===');
    console.log('Total fields: ' + fields.length);
    
    // Analyze ALL field types
    const fieldTypes = {};
    fields.forEach(field => {
      const type = field.constructor.name;
      fieldTypes[type] = (fieldTypes[type] || 0) + 1;
    });
    
    console.log('\nField types found:');
    for (const [type, count] of Object.entries(fieldTypes)) {
      console.log(`  ${type}: ${count}`);
    }
    
    // Look for radio buttons (often used instead of checkboxes)
    const radioButtons = fields.filter(field => field.constructor.name === 'PDFRadioGroup');
    console.log('\n=== RADIO BUTTON ANALYSIS ===');
    console.log('Total radio groups: ' + radioButtons.length);
    
    // List first 20 radio button groups
    console.log('\nFirst 20 radio button details:');
    for (let i = 0; i < Math.min(20, radioButtons.length); i++) {
      const radio = radioButtons[i];
      const name = radio.getName();
      const options = radio.getOptions();
      console.log(`[${i}] Name: "${name}"`);
      console.log(`     Options: ${JSON.stringify(options)}`);
    }
    
    // Look for buttons
    const buttons = fields.filter(field => field.constructor.name === 'PDFButton');
    console.log('\n=== BUTTON ANALYSIS ===');
    console.log('Total buttons: ' + buttons.length);
    
    const dateInfo = formatDate(data.transferDate);
    
    // Build complete addresses
    const buyerFullAddress = data.buyerAddress ? 
      `${data.buyerAddress}\n${data.buyerCity || ''}, ${data.buyerState || 'CA'} ${data.buyerZip || ''}` : '';
    
    const propertyFullAddress = data.propertyAddress ? 
      `${data.propertyAddress}, ${data.propertyCity || ''}, ${data.propertyState || 'CA'} ${data.propertyZip || ''}` : '';
    
    // Text field mappings (these are working fine)
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
    
    // HANDLE RADIO BUTTONS (if they exist)
    if (radioButtons.length > 0) {
      console.log('\n=== ATTEMPTING TO SELECT RADIO BUTTONS ===');
      
      // Principal Residence - Select NO (usually first radio group)
      if (radioButtons.length > 0) {
        try {
          const radio = radioButtons[0];
          const options = radio.getOptions();
          console.log(`Principal Residence options: ${JSON.stringify(options)}`);
          
          // Select NO option (usually second option)
          const noOption = options.find(opt => opt.toLowerCase().includes('no')) || options[1] || options[0];
          if (noOption) {
            radio.select(noOption);
            console.log(`✓ Selected "${noOption}" for Principal Residence`);
          }
        } catch (e) {
          console.log('✗ Failed to select Principal Residence: ' + e.message);
        }
      }
      
      // Disabled Veteran - Select NO (usually second radio group)
      if (radioButtons.length > 1) {
        try {
          const radio = radioButtons[1];
          const options = radio.getOptions();
          console.log(`Disabled Veteran options: ${JSON.stringify(options)}`);
          
          const noOption = options.find(opt => opt.toLowerCase().includes('no')) || options[1] || options[0];
          if (noOption) {
            radio.select(noOption);
            console.log(`✓ Selected "${noOption}" for Disabled Veteran`);
          }
        } catch (e) {
          console.log('✗ Failed to select Disabled Veteran: ' + e.message);
        }
      }
      
      // Section L - Try to find and select YES
      for (let i = 2; i < radioButtons.length; i++) {
        const radio = radioButtons[i];
        const name = radio.getName();
        
        // Check if this is Section L (trust-related)
        if (name && (name.toLowerCase().includes('trust') || 
                     name.toLowerCase().includes('revocable') || 
                     name.toLowerCase().includes('l1') ||
                     name.includes('L.'))) {
          try {
            const options = radio.getOptions();
            console.log(`Section L options at [${i}]: ${JSON.stringify(options)}`);
            
            const yesOption = options.find(opt => opt.toLowerCase().includes('yes')) || options[0];
            if (yesOption) {
              radio.select(yesOption);
              console.log(`✓ Selected "${yesOption}" for Section L`);
              break;
            }
          } catch (e) {
            console.log(`✗ Failed to select Section L at index ${i}: ${e.message}`);
          }
        }
      }
    }
    
    // If no radio buttons, try alternative approaches
    if (radioButtons.length === 0) {
      console.log('\n=== NO RADIO BUTTONS FOUND ===');
      console.log('This form may use image-based checkboxes or non-standard fields.');
      console.log('The text fields have been filled, but checkboxes cannot be marked programmatically.');
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
        message: 'PCOR form generated - check logs for field analysis'
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
