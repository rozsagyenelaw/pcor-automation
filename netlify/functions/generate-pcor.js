const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

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
  const templateMap = {
    'los-angeles': 'preliminary-change-of-ownership (1).pdf',
    'ventura': 'VENTURA County Form BOE-502-A for 2022 (14).pdf',
    'orange': 'ORANGE County Form BOE-502-A for 2021 (18).pdf',
    'san-bernardino': 'SAN_BERNARDINO County Form BOE-502-A for 2025 (23).pdf',
    'riverside': 'RIVERSIDE County Form BOE-502-A for 2018 (6).pdf'
  };
  
  const templateFile = templateMap[county];
  if (!templateFile) {
    throw new Error('Unknown county: ' + county);
  }
  
  const templatePath = path.join(__dirname, '..', '..', 'templates', templateFile);
  
  try {
    console.log('Loading template for ' + county + ' from: ' + templatePath);
    
    if (!fs.existsSync(templatePath)) {
      console.error('Template file not found at: ' + templatePath);
      const templatesDir = path.join(__dirname, '..', '..', 'templates');
      if (fs.existsSync(templatesDir)) {
        const files = fs.readdirSync(templatesDir);
        console.log('Available files in templates directory:', files);
      }
      throw new Error('Template file not found: ' + templateFile);
    }
    
    const buffer = fs.readFileSync(templatePath);
    console.log('Successfully loaded template: ' + templateFile + ' (' + buffer.length + ' bytes)');
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
    
    const dateInfo = formatDate(data.transferDate);
    
    const fieldMappings = {
      'BUYER\'S DAYTIME TELEPHONE NUMBER': data.buyerPhone,
      'BUYER\'S EMAIL ADDRESS': data.buyerEmail,
      'STREET ADDRESS OR PHYSICAL LOCATION OF REAL PROPERTY': data.propertyAddress,
      'CITY': data.propertyCity,
      'STATE': 'CA',
      'ZIP CODE': data.propertyZip,
      'ASSESSOR\'S PARCEL NUMBER': data.apn,
      'SELLER/TRANSFEROR': data.sellerName,
      'MAIL PROPERTY TAX INFORMATION TO (NAME)': data.buyerName,
      'MAIL PROPERTY TAX INFORMATION TO (ADDRESS)': data.buyerAddress,
      'A. Total purchase price': formatCurrency(data.purchasePrice),
      'B. Cash down payment or value of trade or exchange excluding closing costs': formatCurrency(data.downPayment),
      'C. First deed of trust': formatCurrency(data.firstLoan),
      'D. Second deed of trust': formatCurrency(data.secondLoan),
      'MO': dateInfo.month,
      'DAY': dateInfo.day,
      'YEAR': dateInfo.year,
    };
    
    for (const [fieldPattern, value] of Object.entries(fieldMappings)) {
      if (value) {
        try {
          const field = form.getTextField(fieldPattern);
          field.setText(value.toString());
          console.log('Set field "' + fieldPattern + '" to "' + value + '"');
        } catch (e) {
          fields.forEach(field => {
            const fieldName = field.getName();
            if (fieldName.includes(fieldPattern) || fieldPattern.includes(fieldName)) {
              try {
                const textField = form.getTextField(fieldName);
                textField.setText(value.toString());
                console.log('Set field "' + fieldName + '" to "' + value + '" (pattern match)');
              } catch (e2) {
                // Field might not be a text field
              }
            }
          });
        }
      }
    }
    
    const checkboxMappings = {
      'This property is intended as my principal residence': data.principalResidence === 'on',
      'This transfer is solely between spouses': data.exclusions && data.exclusions.includes('spouses'),
      'between parent(s) and child(ren)': data.exclusions && data.exclusions.includes('parentChild'),
      'from grandparent(s) to grandchild(ren)': data.exclusions && data.exclusions.includes('grandparentGrandchild'),
      'This transfer is the result of a cotenant\'s death': data.exclusions && data.exclusions.includes('cotenant'),
      'This transaction is to replace a principal residence owned by a person 55 years of age or older': data.exclusions && data.exclusions.includes('over55'),
      'This transaction is to replace a principal residence by a person who is severely disabled': data.exclusions && data.exclusions.includes('disabled'),
      'Purchase': data.transferType === 'purchase',
      'Gift': data.transferType === 'gift',
      'Inheritance': data.transferType === 'inheritance',
      'Foreclosure': data.transferType === 'foreclosure',
      'Trade or exchange': data.transferType === 'trade',
      'Single-family residence': data.propertyType === 'single-family',
      'Multiple-family residence': data.propertyType === 'multi-family',
      'Commercial/Industrial': data.propertyType === 'commercial',
      'Condominium': data.propertyType === 'condominium',
      'Co-op/Own-your-own': data.propertyType === 'co-op',
      'Manufactured home': data.propertyType === 'manufactured',
      'Unimproved lot': data.propertyType === 'unimproved',
      'Timeshare': data.propertyType === 'timeshare',
    };
    
    for (const [fieldPattern, shouldCheck] of Object.entries(checkboxMappings)) {
      if (shouldCheck !== undefined) {
        try {
          const checkbox = form.getCheckBox(fieldPattern);
          if (shouldCheck) {
            checkbox.check();
          } else {
            checkbox.uncheck();
          }
          console.log((shouldCheck ? 'Checked' : 'Unchecked') + ' "' + fieldPattern + '"');
        } catch (e) {
          fields.forEach(field => {
            const fieldName = field.getName();
            if (fieldName.includes(fieldPattern) || fieldPattern.includes(fieldName)) {
              try {
                const checkbox = form.getCheckBox(fieldName);
                if (shouldCheck) {
                  checkbox.check();
                } else {
                  checkbox.uncheck();
                }
                console.log((shouldCheck ? 'Checked' : 'Unchecked') + ' "' + fieldName + '" (pattern match)');
              } catch (e2) {
                // Field might not be a checkbox
              }
            }
          });
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
