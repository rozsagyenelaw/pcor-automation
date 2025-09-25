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
    
    // CHECKBOX HANDLING - Using index-based approach
    // Most PCOR forms have checkboxes in a predictable order
    
    // Define which checkboxes to check based on data
    const checkboxesToCheck = [];
    
    // Principal Residence Question (usually first 2 checkboxes)
    if (data.principalResidence === 'yes' || data.principalResidence === true || data.principalResidence === 'on') {
      checkboxesToCheck.push(0); // YES checkbox (first one)
    } else if (data.principalResidence === 'no' || data.principalResidence === false) {
      checkboxesToCheck.push(1); // NO checkbox (second one)
    }
    
    // Disabled Veteran Question (usually next 2 checkboxes)
    if (data.disabledVeteran === 'yes') {
      checkboxesToCheck.push(2); // YES checkbox (third one)
    } else if (data.disabledVeteran === 'no') {
      checkboxesToCheck.push(3); // NO checkbox (fourth one)
    }
    
    // Part 1 Transfer Information - Exclusions
    // These typically start around checkbox index 4-6
    let exclusionStartIndex = 4;
    
    if (data.exclusions && Array.isArray(data.exclusions)) {
      data.exclusions.forEach(exclusion => {
        switch(exclusion) {
          case 'spouses':
            checkboxesToCheck.push(exclusionStartIndex); // Section A
            break;
          case 'domesticPartners':
            checkboxesToCheck.push(exclusionStartIndex + 1); // Section B
            break;
          case 'parentChild':
            checkboxesToCheck.push(exclusionStartIndex + 2); // Section C parent-child
            checkboxesToCheck.push(exclusionStartIndex + 3); // between parent(s) and child(ren)
            break;
          case 'grandparentGrandchild':
            checkboxesToCheck.push(exclusionStartIndex + 2); // Section C grandparent
            checkboxesToCheck.push(exclusionStartIndex + 4); // between grandparent(s) and grandchild(ren)
            break;
          case 'cotenant':
            checkboxesToCheck.push(exclusionStartIndex + 5); // Section D
            break;
          case 'over55':
            checkboxesToCheck.push(exclusionStartIndex + 6); // Section E
            break;
          case 'disabled':
            checkboxesToCheck.push(exclusionStartIndex + 7); // Section F
            break;
          case 'disaster':
            checkboxesToCheck.push(exclusionStartIndex + 8); // Section G
            break;
        }
      });
    }
    
    // Special handling for specific counties if needed
    if (county === 'los-angeles' && data.transferType) {
      // Los Angeles might have different checkbox ordering
      // Adjust indices as needed
    }
    
    // Check the checkboxes by index
    console.log('Attempting to check checkboxes at indices: ' + checkboxesToCheck.join(', '));
    
    checkboxesToCheck.forEach(index => {
      if (index < allCheckboxes.length) {
        try {
          const checkbox = allCheckboxes[index];
          const checkboxName = checkbox.getName();
          
          // Get the checkbox through the form to ensure we can manipulate it
          const formCheckbox = form.getCheckBox(checkboxName);
          formCheckbox.check();
          
          console.log(`✓ Checked checkbox [${index}]: "${checkboxName}"`);
        } catch (e) {
          console.log(`✗ Could not check checkbox at index ${index}: ${e.message}`);
          
          // Alternative approach: try to manipulate the widget directly
          try {
            const checkbox = allCheckboxes[index];
            const widgets = checkbox.acroField.getWidgets();
            if (widgets && widgets.length > 0) {
              // Set the appearance state directly
              const states = widgets[0].getAppearanceStates();
              if (states && states.length > 1) {
                // Usually states[0] is unchecked, states[1] is checked
                widgets[0].setAppearanceState(states[1]);
                console.log(`✓ Set checkbox [${index}] via widget manipulation`);
              }
            }
          } catch (e2) {
            console.log(`✗ Widget manipulation also failed for checkbox ${index}`);
          }
        }
      }
    });
    
    // Also try checking by field name patterns for specific checkboxes
    const namedCheckboxPatterns = {
      'YES': data.principalResidence === 'yes',
      'NO': data.principalResidence === 'no',
      'Check Box1': data.principalResidence === 'yes',
      'Check Box2': data.principalResidence === 'no',
      'Check Box3': data.disabledVeteran === 'yes',
      'Check Box4': data.disabledVeteran === 'no',
    };
    
    for (const [pattern, shouldCheck] of Object.entries(namedCheckboxPatterns)) {
      if (shouldCheck) {
        try {
          const checkbox = form.getCheckBox(pattern);
          checkbox.check();
          console.log(`✓ Checked checkbox by name: "${pattern}"`);
        } catch (e) {
          // This pattern didn't match any checkbox
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
    
    // Set default values for checkboxes if not provided
    if (!data.principalResidence) {
      data.principalResidence = 'yes'; // Default to YES for principal residence
    }
    if (!data.disabledVeteran) {
      data.disabledVeteran = 'no'; // Default to NO for disabled veteran
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
