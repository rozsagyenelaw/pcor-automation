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
    
    // Debug: Log all field names
    console.log('Available fields in form:');
    fields.forEach(field => {
      console.log('  - "' + field.getName() + '" (' + field.constructor.name + ')');
    });
    
    const dateInfo = formatDate(data.transferDate);
    
    // Build complete addresses
    const buyerFullAddress = data.buyerAddress ? 
      `${data.buyerAddress}\n${data.buyerCity || ''}, ${data.buyerState || 'CA'} ${data.buyerZip || ''}` : '';
    
    const propertyFullAddress = data.propertyAddress ? 
      `${data.propertyAddress}, ${data.propertyCity || ''}, ${data.propertyState || 'CA'} ${data.propertyZip || ''}` : '';
    
    // Try multiple field name variations for better matching
    const fieldMappings = {
      // Top section - Buyer name and address (combined field)
      'NAME AND MAILING ADDRESS OF BUYER/TRANSFEREE': `${data.buyerName}\n${buyerFullAddress}`,
      'Name and mailing address of buyer/transferee': `${data.buyerName}\n${buyerFullAddress}`,
      'BUYER/TRANSFEREE': `${data.buyerName}\n${buyerFullAddress}`,
      
      // APN
      'ASSESSOR\'S PARCEL NUMBER': data.apn,
      'Assessors parcel number': data.apn,
      'APN': data.apn,
      
      // Seller
      'SELLER/TRANSFEROR': data.sellerName,
      'seller transferor': data.sellerName,
      
      // Contact Information
      'BUYER\'S DAYTIME TELEPHONE NUMBER': data.buyerPhone,
      'buyer\'s daytime telephone number1': data.buyerPhone,
      'area code': data.buyerAreaCode,
      
      'BUYER\'S EMAIL ADDRESS': data.buyerEmail,
      'Buyer\'s email address': data.buyerEmail,
      
      // Property Address - Full address in one field
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
      
      // Financial Information
      'Total purchase price': formatCurrency(data.purchasePrice),
      'A. Total purchase price': formatCurrency(data.purchasePrice),
      
      'Cash down payment or value of trade or exchange excluding closing costs': formatCurrency(data.downPayment),
      'B. Cash down payment': formatCurrency(data.downPayment),
      
      'First deed of trust amount': formatCurrency(data.firstLoan),
      'C. First deed of trust @ %': data.firstLoanInterest,
      'First deed of trust interest': data.firstLoanInterest,
      'First deed of trust interest for': data.firstLoanTerm,
      'First deed of trust monthly payment': formatCurrency(data.firstLoanPayment),
      
      'D. Second deed of trust amount': formatCurrency(data.secondLoan),
      'D. Second deed of trust @': data.secondLoanInterest,
      'D. Second deed of trust interest for': data.secondLoanTerm,
      'D. Second deed of trust monthly payment': formatCurrency(data.secondLoanPayment),
      
      // Page 2 - Signature Section (minimal)
      'Name of buyer/transferee/personal representative/corporate officer (please print)': data.buyerName + ' as Trustor/Trustee',
      'title': 'Trustor/Trustee',
    };
    
    // Fill text fields
    for (const [fieldName, value] of Object.entries(fieldMappings)) {
      if (value) {
        // Try multiple approaches to find and fill the field
        let filled = false;
        
        // Try exact match
        try {
          const field = form.getTextField(fieldName);
          field.setText(value.toString());
          console.log('✓ Set field "' + fieldName + '" to "' + value + '"');
          filled = true;
        } catch (e) {
          // Not found with exact match
        }
        
        // If not filled, try to find by partial match
        if (!filled) {
          const foundField = fields.find(field => {
            const name = field.getName();
            if (!name) return false;
            
            // Try case-insensitive contains match
            return (name.toLowerCase().includes(fieldName.toLowerCase()) || 
                    fieldName.toLowerCase().includes(name.toLowerCase())) &&
                   field.constructor.name.includes('TextField');
          });
          
          if (foundField) {
            try {
              const textField = form.getTextField(foundField.getName());
              textField.setText(value.toString());
              console.log('✓ Set field "' + foundField.getName() + '" to "' + value + '" (partial match)');
              filled = true;
            } catch (e2) {
              console.log('✗ Error setting field: ' + e2.message);
            }
          }
        }
        
        if (!filled) {
          console.log('✗ Could not find field for: "' + fieldName + '"');
        }
      }
    }
    
    // Handle checkboxes - need exact field names
    const checkboxMappings = {};
    
    // Principal Residence
    if (data.principalResidence === 'yes' || data.principalResidence === true) {
      checkboxMappings['YES'] = true;  // First YES checkbox
      checkboxMappings['This property is intended as my principal residence'] = true;
    } else {
      checkboxMappings['NO'] = true;  // First NO checkbox
    }
    
    // Disabled Veteran
    if (data.disabledVeteran === 'yes') {
      checkboxMappings['YES '] = true;  // Second YES (with space)
    } else if (data.disabledVeteran === 'no') {
      checkboxMappings['NO '] = true;  // Second NO (with space)
    }
    
    // Transfer exclusions - Part 1
    if (data.exclusions && Array.isArray(data.exclusions)) {
      if (data.exclusions.includes('spouses')) {
        checkboxMappings['A. This transfer is solely between spouses'] = true;
      }
      if (data.exclusions.includes('domesticPartners')) {
        checkboxMappings['B. This transfer is solely between domestic partners'] = true;
      }
      if (data.exclusions.includes('parentChild')) {
        checkboxMappings['C. This is a transfer'] = true;
        checkboxMappings['between parent(s) and child(ren)'] = true;
      }
      if (data.exclusions.includes('grandparentGrandchild')) {
        checkboxMappings['between grandparent(s) and grandchild(ren)'] = true;
      }
      if (data.exclusions.includes('cotenant')) {
        checkboxMappings['D. This transfer is the result of a cotenant\'s death'] = true;
      }
      if (data.exclusions.includes('over55')) {
        checkboxMappings['E. This transaction is to replace a principal residence'] = true;
      }
      if (data.exclusions.includes('disabled')) {
        checkboxMappings['F. This transaction is to replace a principal residence by a person who is severely disabled'] = true;
      }
    }
    
    // Set checkboxes
    for (const [fieldName, shouldCheck] of Object.entries(checkboxMappings)) {
      if (shouldCheck) {
        let checked = false;
        
        // Try exact match
        try {
          const checkbox = form.getCheckBox(fieldName);
          checkbox.check();
          console.log('✓ Checked "' + fieldName + '"');
          checked = true;
        } catch (e) {
          // Not found with exact match
        }
        
        // If not checked, try to find by index or partial match
        if (!checked) {
          // Get all checkboxes
          const checkboxes = fields.filter(field => field.constructor.name === 'PDFCheckBox');
          
          // For YES/NO checkboxes, use index-based approach
          if (fieldName === 'YES' && checkboxes.length > 0) {
            try {
              const checkbox = form.getCheckBox(checkboxes[0].getName());
              checkbox.check();
              console.log('✓ Checked first YES checkbox (principal residence)');
              checked = true;
            } catch (e) {}
          } else if (fieldName === 'NO' && checkboxes.length > 1) {
            try {
              const checkbox = form.getCheckBox(checkboxes[1].getName());
              checkbox.check();
              console.log('✓ Checked first NO checkbox (principal residence)');
              checked = true;
            } catch (e) {}
          } else if (fieldName === 'YES ' && checkboxes.length > 2) {
            try {
              const checkbox = form.getCheckBox(checkboxes[2].getName());
              checkbox.check();
              console.log('✓ Checked second YES checkbox (veteran status)');
              checked = true;
            } catch (e) {}
          } else if (fieldName === 'NO ' && checkboxes.length > 3) {
            try {
              const checkbox = form.getCheckBox(checkboxes[3].getName());
              checkbox.check();
              console.log('✓ Checked second NO checkbox (veteran status)');
              checked = true;
            } catch (e) {}
          }
          
          // Try partial match for other checkboxes
          if (!checked) {
            const foundCheckbox = checkboxes.find(field => {
              const name = field.getName();
              return name && (
                name.toLowerCase().includes(fieldName.toLowerCase()) ||
                fieldName.toLowerCase().includes(name.toLowerCase())
              );
            });
            
            if (foundCheckbox) {
              try {
                const checkbox = form.getCheckBox(foundCheckbox.getName());
                checkbox.check();
                console.log('✓ Checked "' + foundCheckbox.getName() + '" (partial match for "' + fieldName + '")');
                checked = true;
              } catch (e2) {
                console.log('✗ Error checking checkbox: ' + e2.message);
              }
            }
          }
        }
        
        if (!checked) {
          console.log('✗ Could not find checkbox for: "' + fieldName + '"');
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

