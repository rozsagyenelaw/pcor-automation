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
    
    // Text field mappings - complete list
    const fieldMappings = {
      // Top section - Buyer name and address
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
      'area code': data.buyerAreaCode,
      
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
      
      // Financial Information
      'Total purchase price': formatCurrency(data.purchasePrice),
      'Cash down payment or value of trade or exchange excluding closing costs': formatCurrency(data.downPayment),
      'First deed of trust amount': formatCurrency(data.firstLoan),
      'First deed of trust interest': data.firstLoanInterest,
      'First deed of trust interest for': data.firstLoanTerm,
      'First deed of trust monthly payment': formatCurrency(data.firstLoanPayment),
      'D. Second deed of trust amount': formatCurrency(data.secondLoan),
      'D. Second deed of trust @': data.secondLoanInterest,
      'D. Second deed of trust interest for': data.secondLoanTerm,
      'D. Second deed of trust monthly payment': formatCurrency(data.secondLoanPayment),
      'C. Balloon payment amount': formatCurrency(data.balloonAmount),
      'C. Balloon payment due date': data.balloonDueDate,
      'D. Balloon payment_2': formatCurrency(data.secondBalloonAmount),
      'D. Balloon payment due date': data.secondBalloonDueDate,
      'E. Outstanding balance': formatCurrency(data.outstandingBalance),
      'F. Amount, if any, of real estate commissino fees paid by the buyer which are not included in the purchase price': formatCurrency(data.commissionFees),
      'G. broker name': data.brokerName,
      'G. area code2': data.brokerAreaCode,
      'G. brokers telephone number': data.brokerPhone,
      
      // Page 2 - Signature Section
      'Name of buyer/transferee/personal representative/corporate officer (please print)': data.buyerName + ' as Trustor/Trustee',
      'title': 'Trustor/Trustee',
      'Date signed by buyer/transferee or corporate officer': data.signatureDate || formatDate(new Date()).full,
      'email address': data.signatureEmail || data.buyerEmail,
      'area code3': data.signatureAreaCode || data.buyerAreaCode,
      'Buyer/transferee/legal representative telephone number': data.signaturePhone || data.buyerPhone,
    };
    
    // Fill text fields
    for (const [fieldName, value] of Object.entries(fieldMappings)) {
      if (value) {
        try {
          const field = form.getTextField(fieldName);
          field.setText(value.toString());
        } catch (e) {
          // Try case-insensitive match
          const foundField = fields.find(field => {
            const name = field.getName();
            return name && name.toLowerCase() === fieldName.toLowerCase() && 
                   field.constructor.name.includes('TextField');
          });
          
          if (foundField) {
            try {
              const textField = form.getTextField(foundField.getName());
              textField.setText(value.toString());
            } catch (e2) {
              // Field not found or couldn't be set
            }
          }
        }
      }
    }
    
    // CHECKBOX HANDLING - ONLY THE THREE SPECIFIED CHECKBOXES
    console.log('Checking the three specified checkboxes...');
    
    // 1. Principal Residence - Check YES (first checkbox, index 0)
    if (allCheckboxes.length > 0) {
      try {
        const checkboxName = allCheckboxes[0].getName();
        const checkbox = form.getCheckBox(checkboxName);
        checkbox.check();
        console.log('✓ Checked YES for Principal Residence (index 0)');
      } catch (e) {
        console.log('✗ Could not check Principal Residence YES: ' + e.message);
      }
    }
    
    // 2. Disabled Veteran - Check NO (fourth checkbox, index 3)
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
    
    // 3. Section L - Check YES (L1 checkbox for revocable trust)
    // First try to find L1 by searching for it
    let foundL1 = false;
    
    // Search in the typical range where L1 appears (indices 48-56)
    for (let i = 48; i < Math.min(56, allCheckboxes.length); i++) {
      const checkboxName = allCheckboxes[i].getName();
      if (checkboxName && (
          checkboxName.includes('L1') ||
          checkboxName.includes('revocable trust') ||
          checkboxName.toLowerCase().includes('l1') ||
          (checkboxName.includes('transfer') && checkboxName.includes('trust'))
      )) {
        try {
          const checkbox = form.getCheckBox(checkboxName);
          checkbox.check();
          console.log(`✓ Checked YES for Section L1 at index ${i}`);
          foundL1 = true;
          break;
        } catch (e) {
          console.log(`✗ Found L1 at index ${i} but could not check: ${e.message}`);
        }
      }
    }
    
    // If not found by name search, check index 50 (most common position)
    if (!foundL1 && allCheckboxes.length > 50) {
      try {
        const checkboxName = allCheckboxes[50].getName();
        const checkbox = form.getCheckBox(checkboxName);
        checkbox.check();
        console.log('✓ Checked Section L1 at default index 50');
      } catch (e) {
        console.log('✗ Could not check Section L1 at index 50: ' + e.message);
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
