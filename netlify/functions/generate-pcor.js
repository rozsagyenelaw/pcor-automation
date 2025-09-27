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
    
    // Log all field names for debugging
    const fieldInfo = fields.map(field => ({
      name: field.getName(),
      type: field.constructor.name
    }));
    console.log('All fields:', JSON.stringify(fieldInfo, null, 2));
    
    const dateInfo = formatDate(data.transferDate);
    
    // Build complete addresses
    const buyerFullAddress = data.buyerAddress ? 
      `${data.buyerAddress}\n${data.buyerCity || ''}, ${data.buyerState || 'CA'} ${data.buyerZip || ''}` : '';
    
    const propertyFullAddress = data.propertyAddress ? 
      `${data.propertyAddress}, ${data.propertyCity || ''}, ${data.propertyState || 'CA'} ${data.propertyZip || ''}` : '';
    
    // Fill text fields - comprehensive list
    const textFieldMappings = createTextFieldMappings(data, {
      dateInfo,
      buyerFullAddress,
      propertyFullAddress
    });
    
    fillTextFields(form, fields, textFieldMappings);
    
    // Handle checkboxes - FIXED to only check appropriate boxes
    await handlePCORCheckboxes(form, fields, data);
    
    const pdfBytesResult = await pdfDoc.save();
    return pdfBytesResult;
    
  } catch (error) {
    console.error('Error filling PCOR form:', error);
    throw error;
  }
}

function createTextFieldMappings(data, computed) {
  // Create comprehensive field mappings with variations
  return {
    // Buyer/Transferee Information - Multiple variations
    'NAME AND MAILING ADDRESS OF BUYER/TRANSFEREE': `${data.buyerName}\n${computed.buyerFullAddress}`,
    'Name and mailing address of buyer/transferee': `${data.buyerName}\n${computed.buyerFullAddress}`,
    'NAME AND MAILING ADDRESS OF BUYERTRANSFEREE': `${data.buyerName}\n${computed.buyerFullAddress}`,
    'Buyer Name': data.buyerName,
    'BuyerName': data.buyerName,
    'Text1': `${data.buyerName}\n${computed.buyerFullAddress}`,
    
    // APN variations
    'ASSESSOR\'S PARCEL NUMBER': data.apn,
    'Assessors parcel number': data.apn,
    'ASSESSORS PARCEL NUMBER': data.apn,
    'APN': data.apn,
    'apn': data.apn,
    'ParcelNumber': data.apn,
    'Text2': data.apn,
    
    // Seller/Transferor variations
    'SELLER/TRANSFEROR': data.sellerName,
    'SELLERTRANSFEROR': data.sellerName,
    'seller transferor': data.sellerName,
    'Seller': data.sellerName,
    'SellerName': data.sellerName,
    'Text3': data.sellerName,
    
    // Phone and Email
    'BUYER\'S DAYTIME TELEPHONE NUMBER': data.buyerPhone,
    'BUYERS DAYTIME TELEPHONE NUMBER': data.buyerPhone,
    'buyer\'s daytime telephone number': data.buyerPhone,
    'buyer\'s daytime telephone number1': data.buyerPhone,
    'Phone': data.buyerPhone,
    'area code': data.buyerAreaCode,
    'AreaCode': data.buyerAreaCode,
    
    'BUYER\'S EMAIL ADDRESS': data.buyerEmail,
    'BUYERS EMAIL ADDRESS': data.buyerEmail,
    'Buyer\'s email address': data.buyerEmail,
    'Email': data.buyerEmail,
    
    // Property Address variations
    'STREET ADDRESS OR PHYSICAL LOCATION OF REAL PROPERTY': computed.propertyFullAddress,
    'street address or physical location of real property': computed.propertyFullAddress,
    'Property Address': computed.propertyFullAddress,
    'PropertyAddress': computed.propertyFullAddress,
    'Text4': computed.propertyFullAddress,
    
    // Date fields - multiple formats
    'MO': computed.dateInfo.month,
    'Month': computed.dateInfo.month,
    'MONTH': computed.dateInfo.month,
    'mo': computed.dateInfo.month,
    
    'DAY': computed.dateInfo.day,
    'Day': computed.dateInfo.day,
    'day': computed.dateInfo.day,
    
    'YEAR': computed.dateInfo.year,
    'Year': computed.dateInfo.year,
    'year': computed.dateInfo.year,
    'YR': computed.dateInfo.year.substring(2),
    
    // Mail Property Tax Information
    'MAIL PROPERTY TAX INFORMATION TO (NAME)': data.buyerName,
    'MAIL PROPERTY TAX INFORMATION TO NAME': data.buyerName,
    'mail property tax information to (name)': data.buyerName,
    'MailTaxName': data.buyerName,
    
    'MAIL PROPERTY TAX INFORMATION TO (ADDRESS)': data.mailingAddress || data.buyerAddress,
    'MAIL PROPERTY TAX INFORMATION TO ADDRESS': data.mailingAddress || data.buyerAddress,
    'Mail property tax informatino to address': data.mailingAddress || data.buyerAddress,
    'MailTaxAddress': data.mailingAddress || data.buyerAddress,
    
    'CITY': data.mailingCity || data.buyerCity || data.propertyCity,
    'City': data.mailingCity || data.buyerCity || data.propertyCity,
    'city': data.mailingCity || data.buyerCity || data.propertyCity,
    
    'STATE': data.mailingState || data.buyerState || 'CA',
    'State': data.mailingState || data.buyerState || 'CA',
    'state': data.mailingState || data.buyerState || 'CA',
    'ST': data.mailingState || data.buyerState || 'CA',
    
    'ZIP CODE': data.mailingZip || data.buyerZip || data.propertyZip,
    'ZIP': data.mailingZip || data.buyerZip || data.propertyZip,
    'Zip': data.mailingZip || data.buyerZip || data.propertyZip,
    'ZipCode': data.mailingZip || data.buyerZip || data.propertyZip,
    
    // Financial Information
    'Total purchase price': formatCurrency(data.purchasePrice),
    'TotalPurchasePrice': formatCurrency(data.purchasePrice),
    'Purchase Price': formatCurrency(data.purchasePrice),
    
    'Cash down payment or value of trade or exchange excluding closing costs': formatCurrency(data.downPayment),
    'Down Payment': formatCurrency(data.downPayment),
    'DownPayment': formatCurrency(data.downPayment),
    
    'First deed of trust amount': formatCurrency(data.firstLoan),
    'First deed of trust @': data.firstLoanInterest,
    'First deed of trust interest': data.firstLoanInterest,
    'First deed of trust interest for': data.firstLoanTerm,
    'First deed of trust monthly payment': formatCurrency(data.firstLoanPayment),
    
    'Second deed of trust amount': formatCurrency(data.secondLoan),
    'D. Second deed of trust amount': formatCurrency(data.secondLoan),
    'D. Second deed of trust @': data.secondLoanInterest,
    'D. Second deed of trust interest for': data.secondLoanTerm,
    'D. Second deed of trust monthly payment': formatCurrency(data.secondLoanPayment),
    
    'Balloon payment amount': formatCurrency(data.balloonAmount),
    'C. Balloon payment amount': formatCurrency(data.balloonAmount),
    'C. Balloon payment due date': data.balloonDueDate,
    'D. Balloon payment_2': formatCurrency(data.secondBalloonAmount),
    'D. Balloon payment due date': data.secondBalloonDueDate,
    
    'Outstanding balance': formatCurrency(data.outstandingBalance),
    'E. Outstanding balance': formatCurrency(data.outstandingBalance),
    
    'Amount, if any, of real estate commissino fees paid by the buyer which are not included in the purchase price': formatCurrency(data.commissionFees),
    'F. Amount, if any, of real estate commissino fees paid by the buyer which are not included in the purchase price': formatCurrency(data.commissionFees),
    'Commission Fees': formatCurrency(data.commissionFees),
    
    'G. broker name': data.brokerName,
    'Broker Name': data.brokerName,
    'G. area code2': data.brokerAreaCode,
    'G. brokers telephone number': data.brokerPhone,
    'Broker Phone': data.brokerPhone,
    
    // Signature Section
    'Name of buyer/transferee/personal representative/corporate officer (please print)': data.buyerName + ' as Trustee',
    'Name of buyer transferee personal representative corporate officer please print': data.buyerName + ' as Trustee',
    'SignatureName': data.buyerName + ' as Trustee',
    
    'title': 'Trustee',
    'Title': 'Trustee',
    
    'Date signed by buyer/transferee or corporate officer': data.signatureDate || formatDate(new Date()).full,
    'Date signed by buyer transferee or corporate officer': data.signatureDate || formatDate(new Date()).full,
    'SignatureDate': data.signatureDate || formatDate(new Date()).full,
    
    'email address': data.signatureEmail || data.buyerEmail,
    'Email Address': data.signatureEmail || data.buyerEmail,
    
    'area code3': data.signatureAreaCode || data.buyerAreaCode,
    'Buyer/transferee/legal representative telephone number': data.signaturePhone || data.buyerPhone,
    'Buyer transferee legal representative telephone number': data.signaturePhone || data.buyerPhone,
  };
}

function fillTextFields(form, fields, mappings) {
  let filledCount = 0;
  
  for (const [fieldName, value] of Object.entries(mappings)) {
    if (!value) continue;
    
    // Try exact match
    try {
      const field = form.getTextField(fieldName);
      field.setText(value.toString());
      console.log(`✓ Filled text field: "${fieldName}"`);
      filledCount++;
      continue;
    } catch (e) {
      // Not found with exact name
    }
    
    // Try case-insensitive match
    const foundField = fields.find(field => {
      const name = field.getName();
      return name && 
             name.toLowerCase() === fieldName.toLowerCase() && 
             field.constructor.name.includes('TextField');
    });
    
    if (foundField) {
      try {
        const textField = form.getTextField(foundField.getName());
        textField.setText(value.toString());
        console.log(`✓ Filled text field (case-insensitive): "${foundField.getName()}"`);
        filledCount++;
      } catch (e) {
        console.log(`✗ Could not fill field: "${foundField.getName()}"`);
      }
    }
  }
  
  console.log(`Filled ${filledCount} text fields`);
}

async function handlePCORCheckboxes(form, fields, data) {
  // Get all checkboxes
  const checkboxes = fields.filter(field => 
    field.constructor.name.includes('PDFCheckBox') || 
    field.constructor.name.includes('CheckBox')
  );
  
  console.log(`Found ${checkboxes.length} total checkboxes`);
  
  // For trust transfers, we only check 3 specific boxes:
  // 1. Principal Residence - YES (checkbox index 0)
  // 2. Disabled Veteran - NO (checkbox index 3)
  // 3. Part 1 Section L.1 - YES (checkbox around index 23-25)
  
  let checkedCount = 0;
  
  // Process each checkbox by index
  checkboxes.forEach((checkbox, index) => {
    const name = checkbox.getName() || '';
    
    try {
      const cb = form.getCheckBox(name);
      
      // Principal Residence YES - typically the first checkbox
      if (index === 0) {
        cb.check();
        console.log(`✓ Checked Principal Residence YES at index ${index}: "${name}"`);
        checkedCount++;
      }
      // Disabled Veteran NO - typically the 4th checkbox (index 3)
      else if (index === 3) {
        cb.check();
        console.log(`✓ Checked Disabled Veteran NO at index ${index}: "${name}"`);
        checkedCount++;
      }
      // Section L.1 for trust transfers - typically around index 23-25
      else if (index >= 23 && index <= 25) {
        const lowerName = name.toLowerCase();
        if (lowerName.includes('l') || lowerName.includes('revocable') || lowerName.includes('trust')) {
          cb.check();
          console.log(`✓ Checked Section L.1 at index ${index}: "${name}"`);
          checkedCount++;
        } else {
          cb.uncheck();
        }
      }
      // All other checkboxes should be unchecked
      else {
        cb.uncheck();
        console.log(`✗ Unchecked box at index ${index}: "${name}"`);
      }
    } catch (e) {
      console.log(`Could not modify checkbox at index ${index}: "${name}"`);
    }
  });
  
  // If we didn't get exactly 3 checks, try a more targeted approach
  if (checkedCount !== 3) {
    console.log('Attempting alternate checkbox identification strategy');
    checkedCount = 0;
    
    for (const checkbox of checkboxes) {
      const name = checkbox.getName() || '';
      const lowerName = name.toLowerCase();
      
      try {
        const cb = form.getCheckBox(name);
        
        // Look for specific patterns in checkbox names
        if ((lowerName === 'yes' && checkboxes.indexOf(checkbox) === 0) ||
            (lowerName.includes('principal') && lowerName.includes('yes')) ||
            (lowerName === 'checkbox1')) {
          cb.check();
          console.log(`✓ Checked Principal Residence YES: "${name}"`);
          checkedCount++;
        }
        else if ((lowerName === 'no' && checkboxes.indexOf(checkbox) === 3) ||
                 (lowerName.includes('veteran') && lowerName.includes('no')) ||
                 (lowerName === 'checkbox4')) {
          cb.check();
          console.log(`✓ Checked Disabled Veteran NO: "${name}"`);
          checkedCount++;
        }
        else if (lowerName.includes('l1') || 
                 lowerName.includes('l.1') ||
                 (lowerName.includes('revocable') && lowerName.includes('trust')) ||
                 lowerName === 'checkbox24' ||
                 lowerName === 'checkbox25') {
          cb.check();
          console.log(`✓ Checked Section L.1: "${name}"`);
          checkedCount++;
        }
        else {
          cb.uncheck();
        }
      } catch (e) {
        console.log(`Error processing checkbox: "${name}"`);
      }
    }
  }
  
  console.log(`Total checkboxes checked: ${checkedCount} (expected: 3)`);
  return checkedCount;
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
    console.log('Form data keys:', Object.keys(data));
    
    // Set defaults for trust transfer
    if (!data.principalResidence) data.principalResidence = 'yes';
    if (!data.disabledVeteran) data.disabledVeteran = 'no';
    
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
        details: error.message,
        stack: error.stack
      })
    };
  }
};
