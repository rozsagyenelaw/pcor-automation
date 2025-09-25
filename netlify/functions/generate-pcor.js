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
  // Map county names to actual file names in your repository
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
  
  // Read the file from the local file system
  // The path is relative to the function file location
  const templatePath = path.join(__dirname, '..', '..', 'templates', templateFile);
  
  try {
    console.log('Loading template for ' + county + ' from: ' + templatePath);
    
    // Check if file exists
    if (!fs.existsSync(templatePath)) {
      console.error('Template file not found at: ' + templatePath);
      // List files in the templates directory for debugging
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
    
    // Log all field names for debugging
    console.log('Available fields:');
    fields.forEach(field => {
      console.log('  - ' + field.getName() + ' (' + field.constructor.name + ')');
    });
    
    const dateInfo = formatDate(data.transferDate);
    
    // Helper function to set text field value with fallback
    const setTextField = (fieldNames, value) => {
      if (!value) return;
      
      // fieldNames can be a string or array of strings
      const names = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
      
      for (const fieldName of names) {
        try {
          const field = form.getTextField(fieldName);
          field.setText(value.toString());
          console.log('Set field "' + fieldName + '" to "' + value + '"');
          return; // Success, stop trying other names
        } catch (e) {
          // Try partial match
          const found = fields.find(f => {
            const name = f.getName();
            return name && (
              name.toLowerCase().includes(fieldName.toLowerCase()) ||
              fieldName.toLowerCase().includes(name.toLowerCase())
            );
          });
          
          if (found && found.constructor.name === 'PDFTextField') {
            try {
              const textField = form.getTextField(found.getName());
              textField.setText(value.toString());
              console.log('Set field "' + found.getName() + '" to "' + value + '" (partial match)');
              return;
            } catch (e2) {
              // Continue to next field name
            }
          }
        }
      }
      console.log('Could not find field for: ' + names.join(', '));
    };
    
    // Helper function to check/uncheck checkbox with fallback
    const setCheckbox = (fieldNames, shouldCheck) => {
      if (shouldCheck === undefined || shouldCheck === null) return;
      
      const names = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
      
      for (const fieldName of names) {
        try {
          const checkbox = form.getCheckBox(fieldName);
          if (shouldCheck) {
            checkbox.check();
          } else {
            checkbox.uncheck();
          }
          console.log((shouldCheck ? 'Checked' : 'Unchecked') + ' "' + fieldName + '"');
          return; // Success
        } catch (e) {
          // Try partial match
          const found = fields.find(f => {
            const name = f.getName();
            return name && (
              name.toLowerCase().includes(fieldName.toLowerCase()) ||
              fieldName.toLowerCase().includes(name.toLowerCase())
            );
          });
          
          if (found && found.constructor.name === 'PDFCheckBox') {
            try {
              const checkbox = form.getCheckBox(found.getName());
              if (shouldCheck) {
                checkbox.check();
              } else {
                checkbox.uncheck();
              }
              console.log((shouldCheck ? 'Checked' : 'Unchecked') + ' "' + found.getName() + '" (partial match)');
              return;
            } catch (e2) {
              // Continue to next field name
            }
          }
        }
      }
    };
    
    // Fill text fields
    setTextField(['BUYER\'S DAYTIME TELEPHONE NUMBER', 'Buyer Phone', 'Telephone'], data.buyerPhone);
    setTextField(['BUYER\'S EMAIL ADDRESS', 'Buyer Email', 'Email'], data.buyerEmail);
    setTextField(['STREET ADDRESS OR PHYSICAL LOCATION OF REAL PROPERTY', 'Property Address', 'Street Address'], data.propertyAddress);
    setTextField(['CITY', 'City'], data.propertyCity);
    setTextField(['STATE', 'State'], 'CA');
    setTextField(['ZIP CODE', 'Zip', 'ZIP'], data.propertyZip);
    setTextField(['ASSESSOR\'S PARCEL NUMBER', 'APN', 'Parcel Number'], data.apn);
    setTextField(['SELLER/TRANSFEROR', 'Seller', 'Transferor'], data.sellerName);
    setTextField(['BUYER/TRANSFEREE', 'Buyer', 'Transferee'], data.buyerName);
    setTextField(['MAIL PROPERTY TAX INFORMATION TO (NAME)', 'Mail To Name'], data.buyerName);
    setTextField(['MAIL PROPERTY TAX INFORMATION TO (ADDRESS)', 'Mail To Address'], data.buyerAddress);
    setTextField(['Total purchase price', 'Purchase Price'], formatCurrency(data.purchasePrice));
    setTextField(['Cash down payment', 'Down Payment'], formatCurrency(data.downPayment));
    setTextField(['First deed of trust', 'First Loan'], formatCurrency(data.firstLoan));
    setTextField(['Second deed of trust', 'Second Loan'], formatCurrency(data.secondLoan));
    
    // Set date fields
    setTextField(['MO', 'Month'], dateInfo.month);
    setTextField(['DAY', 'Day'], dateInfo.day);
    setTextField(['YEAR', 'Year'], dateInfo.year);
    
    // Handle checkboxes for transfer type
    if (data.transferType) {
      setCheckbox(['Purchase'], data.transferType === 'purchase');
      setCheckbox(['Gift'], data.transferType === 'gift');
      setCheckbox(['Inheritance'], data.transferType === 'inheritance');
      setCheckbox(['Foreclosure'], data.transferType === 'foreclosure');
      setCheckbox(['Trade or exchange', 'Trade'], data.transferType === 'trade');
    }
    
    // Handle checkboxes for property type
    if (data.propertyType) {
      setCheckbox(['Single-family residence', 'Single Family'], data.propertyType === 'single-family');
      setCheckbox(['Multiple-family residence', 'Multi Family'], data.propertyType === 'multi-family');
      setCheckbox(['Commercial/Industrial', 'Commercial'], data.propertyType === 'commercial');
      setCheckbox(['Condominium'], data.propertyType === 'condominium');
      setCheckbox(['Co-op/Own-your-own', 'Co-op'], data.propertyType === 'co-op');
      setCheckbox(['Manufactured home', 'Manufactured'], data.propertyType === 'manufactured');
      setCheckbox(['Unimproved lot', 'Vacant Land'], data.propertyType === 'unimproved');
      setCheckbox(['Timeshare'], data.propertyType === 'timeshare');
    }
    
    // Handle exclusions
    if (data.exclusions && Array.isArray(data.exclusions)) {
      setCheckbox(['between spouses', 'spouses'], data.exclusions.includes('spouses'));
      setCheckbox(['parent(s) and child(ren)', 'parent child'], data.exclusions.includes('parentChild'));
      setCheckbox(['grandparent(s) to grandchild(ren)', 'grandparent'], data.exclusions.includes('grandparentGrandchild'));
      setCheckbox(['cotenant\'s death', 'cotenant'], data.exclusions.includes('cotenant'));
      setCheckbox(['person 55 years', 'over 55'], data.exclusions.includes('over55'));
      setCheckbox(['severely disabled', 'disabled'], data.exclusions.includes('disabled'));
    }
    
    // Handle principal residence checkbox
    setCheckbox(['principal residence', 'Primary Residence'], data.principalResidence === 'on');
    
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
    console.log('Form data:', JSON.stringify(data, null, 2));
    
    if (!data.county) {
      throw new Error('County is required');
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
    console.error('Stack trace:', error.stack);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to generate PCOR form',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};
