const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

function formatDate(dateString) {
  if (!dateString) return "";
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
  
  // Use your deployed Netlify site URL
  const url = `https://melodic-capybara-d4f2c8.netlify.app/templates/${templateFile}`;
  
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
    
    // Log all field names to help with mapping
    console.log('Available fields in form:');
    fields.forEach(field => {
      console.log('  - ' + field.getName() + ' (' + field.constructor.name + ')');
    });
    
    const dateInfo = formatDate(data.transferDate);
    
    // Try to fill text fields with multiple possible field names
    const fieldMappings = {
      // Buyer/Transferee Information
      'BUYER\'S DAYTIME TELEPHONE NUMBER': data.buyerPhone,
      'Buyer Phone': data.buyerPhone,
      'Telephone': data.buyerPhone,
      
      'BUYER\'S EMAIL ADDRESS': data.buyerEmail,
      'Buyer Email': data.buyerEmail,
      'Email': data.buyerEmail,
      
      'BUYER\'S NAME': data.buyerName,
      'BUYER/TRANSFEREE': data.buyerName,
      'Buyer': data.buyerName,
      'Transferee': data.buyerName,
      
      // Property Information
      'STREET ADDRESS OR PHYSICAL LOCATION OF REAL PROPERTY': data.propertyAddress,
      'Property Address': data.propertyAddress,
      'Street Address': data.propertyAddress,
      
      'CITY': data.propertyCity,
      'City': data.propertyCity,
      
      'STATE': 'CA',
      'State': 'CA',
      
      'ZIP CODE': data.propertyZip,
      'Zip': data.propertyZip,
      'ZIP': data.propertyZip,
      
      'ASSESSOR\'S PARCEL NUMBER': data.apn,
      'APN': data.apn,
      'Parcel Number': data.apn,
      
      // Seller/Transferor Information
      'SELLER/TRANSFEROR': data.sellerName,
      'Seller': data.sellerName,
      'Transferor': data.sellerName,
      
      // Mailing Address
      'MAIL PROPERTY TAX INFORMATION TO (NAME)': data.buyerName,
      'Mail To Name': data.buyerName,
      
      'MAIL PROPERTY TAX INFORMATION TO (ADDRESS)': data.buyerAddress,
      'Mail To Address': data.buyerAddress,
      
      // Financial Information
      'A. Total purchase price': formatCurrency(data.purchasePrice),
      'Total purchase price': formatCurrency(data.purchasePrice),
      'Purchase Price': formatCurrency(data.purchasePrice),
      
      'B. Cash down payment or value of trade or exchange excluding closing costs': formatCurrency(data.downPayment),
      'Cash down payment': formatCurrency(data.downPayment),
      'Down Payment': formatCurrency(data.downPayment),
      
      'C. First deed of trust': formatCurrency(data.firstLoan),
      'First deed of trust': formatCurrency(data.firstLoan),
      'First Loan': formatCurrency(data.firstLoan),
      
      'D. Second deed of trust': formatCurrency(data.secondLoan),
      'Second deed of trust': formatCurrency(data.secondLoan),
      'Second Loan': formatCurrency(data.secondLoan),
      
      // Date fields
      'MO': dateInfo.month,
      'Month': dateInfo.month,
      
      'DAY': dateInfo.day,
      'Day': dateInfo.day,
      
      'YEAR': dateInfo.year,
      'Year': dateInfo.year,
    };
    
    // Fill text fields
    for (const [fieldPattern, value] of Object.entries(fieldMappings)) {
      if (value) {
        // Try exact match first
        try {
          const field = form.getTextField(fieldPattern);
          field.setText(value.toString());
          console.log('Set field "' + fieldPattern + '" to "' + value + '"');
          continue;
        } catch (e) {
          // Field not found with exact name
        }
        
        // Try to find field by partial match
        const foundField = fields.find(field => {
          const fieldName = field.getName();
          if (!fieldName) return false;
          
          // Check if field name contains pattern or pattern contains field name
          return fieldName.toLowerCase().includes(fieldPattern.toLowerCase()) ||
                 fieldPattern.toLowerCase().includes(fieldName.toLowerCase());
        });
        
        if (foundField) {
          try {
            const textField = form.getTextField(foundField.getName());
            textField.setText(value.toString());
            console.log('Set field "' + foundField.getName() + '" to "' + value + '" (pattern match)');
          } catch (e) {
            // Field might not be a text field
          }
        }
      }
    }
    
    // Handle checkboxes
    const checkboxMappings = {
      // Principal residence
      'This property is intended as my principal residence': data.principalResidence === 'on',
      'principal residence': data.principalResidence === 'on',
      
      // Transfer exclusions
      'This transfer is solely between spouses': data.exclusions && data.exclusions.includes('spouses'),
      'between spouses': data.exclusions && data.exclusions.includes('spouses'),
      'spouses': data.exclusions && data.exclusions.includes('spouses'),
      
      'between parent(s) and child(ren)': data.exclusions && data.exclusions.includes('parentChild'),
      'parent child': data.exclusions && data.exclusions.includes('parentChild'),
      'parent(s) and child(ren)': data.exclusions && data.exclusions.includes('parentChild'),
      
      'from grandparent(s) to grandchild(ren)': data.exclusions && data.exclusions.includes('grandparentGrandchild'),
      'grandparent grandchild': data.exclusions && data.exclusions.includes('grandparentGrandchild'),
      'grandparent': data.exclusions && data.exclusions.includes('grandparentGrandchild'),
      
      'This transfer is the result of a cotenant\'s death': data.exclusions && data.exclusions.includes('cotenant'),
      'cotenant\'s death': data.exclusions && data.exclusions.includes('cotenant'),
      'cotenant': data.exclusions && data.exclusions.includes('cotenant'),
      
      'This transaction is to replace a principal residence owned by a person 55 years of age or older': data.exclusions && data.exclusions.includes('over55'),
      'person 55 years': data.exclusions && data.exclusions.includes('over55'),
      'over 55': data.exclusions && data.exclusions.includes('over55'),
      
      'This transaction is to replace a principal residence by a person who is severely disabled': data.exclusions && data.exclusions.includes('disabled'),
      'severely disabled': data.exclusions && data.exclusions.includes('disabled'),
      'disabled': data.exclusions && data.exclusions.includes('disabled'),
      
      // Transfer type
      'Purchase': data.transferType === 'purchase',
      'Gift': data.transferType === 'gift',
      'Inheritance': data.transferType === 'inheritance',
      'Foreclosure': data.transferType === 'foreclosure',
      'Trade or exchange': data.transferType === 'trade',
      'Trade': data.transferType === 'trade',
      
      // Property type
      'Single-family residence': data.propertyType === 'single-family',
      'Single Family': data.propertyType === 'single-family',
      
      'Multiple-family residence': data.propertyType === 'multi-family',
      'Multi Family': data.propertyType === 'multi-family',
      
      'Commercial/Industrial': data.propertyType === 'commercial',
      'Commercial': data.propertyType === 'commercial',
      
      'Condominium': data.propertyType === 'condominium',
      'Co-op/Own-your-own': data.propertyType === 'co-op',
      'Co-op': data.propertyType === 'co-op',
      
      'Manufactured home': data.propertyType === 'manufactured',
      'Manufactured': data.propertyType === 'manufactured',
      
      'Unimproved lot': data.propertyType === 'unimproved',
      'Vacant Land': data.propertyType === 'unimproved',
      
      'Timeshare': data.propertyType === 'timeshare',
    };
    
    // Set checkboxes
    for (const [fieldPattern, shouldCheck] of Object.entries(checkboxMappings)) {
      if (shouldCheck !== undefined) {
        // Try exact match first
        try {
          const checkbox = form.getCheckBox(fieldPattern);
          if (shouldCheck) {
            checkbox.check();
          } else {
            checkbox.uncheck();
          }
          console.log((shouldCheck ? 'Checked' : 'Unchecked') + ' "' + fieldPattern + '"');
          continue;
        } catch (e) {
          // Field not found with exact name
        }
        
        // Try to find checkbox by partial match
        const foundField = fields.find(field => {
          const fieldName = field.getName();
          if (!fieldName) return false;
          
          // Check if field name contains pattern or pattern contains field name
          return (fieldName.toLowerCase().includes(fieldPattern.toLowerCase()) ||
                  fieldPattern.toLowerCase().includes(fieldName.toLowerCase())) &&
                 field.constructor.name === 'PDFCheckBox';
        });
        
        if (foundField) {
          try {
            const checkbox = form.getCheckBox(foundField.getName());
            if (shouldCheck) {
              checkbox.check();
            } else {
              checkbox.uncheck();
            }
            console.log((shouldCheck ? 'Checked' : 'Unchecked') + ' "' + foundField.getName() + '" (pattern match)');
          } catch (e) {
            // Error checking/unchecking
          }
        }
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
    console.log('Form data:', data);
    
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
