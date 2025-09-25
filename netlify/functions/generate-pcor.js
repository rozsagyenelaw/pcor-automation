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
    
    // Log all field names to help with mapping
    console.log('Available fields in form:');
    fields.forEach(field => {
      console.log('  - ' + field.getName() + ' (' + field.constructor.name + ')');
    });
    
    const dateInfo = formatDate(data.transferDate);
    
    // Updated field mappings based on the correct field names
    const fieldMappings = {
      // Buyer/Transferee Information
      'Name and mailing address of buyer/transferee': data.buyerName,
      'buyer\'s daytime telephone number1': data.buyerPhone,
      'Buyer\'s email address': data.buyerEmail,
      
      // Property Information
      'street address or physical location of real property': data.propertyAddress,
      'city': data.propertyCity,
      'state': 'CA',
      'ZIP code': data.propertyZip,
      'Assessors parcel number': data.apn,
      
      // Seller/Transferor Information
      'seller transferor': data.sellerName,
      'area code': data.sellerAreaCode,
      
      // Transfer Date
      'Month': dateInfo.month,
      'day': dateInfo.day,
      'year': dateInfo.year,
      
      // Mailing Information
      'mail property tax information to (name)': data.buyerName,
      'Mail property tax informatino to address': data.buyerAddress,
      
      // Purchase Information
      'Total purchase price': formatCurrency(data.purchasePrice),
      'Cash down payment or value of trade or exchange excluding closing costs': formatCurrency(data.downPayment),
      
      // First Loan Information
      'First deed of trust amount': formatCurrency(data.firstLoan),
      'First deed of trust interest': data.firstLoanInterest,
      'First deed of trust interest for': data.firstLoanTerm,
      'First deed of trust monthly payment': formatCurrency(data.firstLoanPayment),
      
      // Second Loan Information
      'D. Second deed of trust amount': formatCurrency(data.secondLoan),
      'D. Second deed of trust @': data.secondLoanInterest,
      'D. Second deed of trust interest for': data.secondLoanTerm,
      'D. Second deed of trust monthly payment': formatCurrency(data.secondLoanPayment),
      
      // Balloon Payment Information
      'C. Balloon payment amount': formatCurrency(data.balloonAmount),
      'C. Balloon payment due date': data.balloonDueDate,
      'D. Balloon payment_2': formatCurrency(data.secondBalloonAmount),
      'D. Balloon payment due date': data.secondBalloonDueDate,
      
      // Other Financial Information
      'E. Outstanding balance': formatCurrency(data.outstandingBalance),
      'F. Amount, if any, of real estate commissino fees paid by the buyer which are not included in the purchase price': formatCurrency(data.commissionFees),
      
      // Broker Information
      'G. broker name': data.brokerName,
      'G. area code2': data.brokerAreaCode,
      'G. brokers telephone number': data.brokerPhone,
      
      // Signature Section on Page 2
      'Name of buyer/transferee/personal representative/corporate officer (please print)': data.signatureName || (data.buyerName ? data.buyerName + ' as Trustor/Trustee' : ''),
      'Date signed by buyer/transferee or corporate officer': data.signatureDate || formatDate(new Date()).full,
      'title': data.signatureTitle || 'Trustor/Trustee',
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
          console.log('Set field "' + fieldName + '" to "' + value + '"');
        } catch (e) {
          // Try case-insensitive match
          const foundField = fields.find(field => {
            const name = field.getName();
            return name && name.toLowerCase() === fieldName.toLowerCase();
          });
          
          if (foundField && foundField.constructor.name === 'PDFTextField') {
            try {
              const textField = form.getTextField(foundField.getName());
              textField.setText(value.toString());
              console.log('Set field "' + foundField.getName() + '" to "' + value + '" (case-insensitive match)');
            } catch (e2) {
              console.log('Could not set field "' + fieldName + '": ' + e2.message);
            }
          }
        }
      }
    }
    
    // Handle checkboxes with exact field names
    const checkboxMappings = {
      // Principal Residence
      'This property is intended as my principal residence. If YES, please indicate the date of occupancy or intended occupancy': data.principalResidence === 'on',
      
      // Disabled Veteran Status
      'Are you a disabled veteran or an unmarried surviving spouse of a disabled veteran who was compensated at 100% by the Department of Veterans Affairs': data.disabledVeteran === 'yes',
      'Are you a disabled veteran or an unmarried surviving spouse of a disabled veteran who was compensated at 100% by the Department of Veterans Affairs_no': data.disabledVeteran === 'no',
      
      // Transfer Types - Section A-G
      'A. This transfer is solely between spouses (addition or removal of a spouse, death of a spouse, divorce settlement, etc.)': data.exclusions && data.exclusions.includes('spouses'),
      'B. This transfer is solely between domestic partners currently registered with the California Secretary of State (addition or removal of a partner, death of a partner, termination settlement, etc.)': data.exclusions && data.exclusions.includes('domesticPartners'),
      'C. This is a transfer between: parents and children or grandparents and grandchildren': data.exclusions && data.exclusions.includes('parentChild'),
      'C. This is a transfer between parent(s) and child(ren)': data.exclusions && data.exclusions.includes('parentChild'),
      'D.This transfer is the result of a cotenant\'s death': data.exclusions && data.exclusions.includes('cotenant'),
      'E. This transaction is to replace a principal residence by a person 55 years of age or older': data.exclusions && data.exclusions.includes('over55'),
      'F. This transaction is to replace a principal residence by a person who is severely disabled as defined by Revenue and Taxation Code section 69.5': data.exclusions && data.exclusions.includes('disabled'),
      'G. This transaction is to replace a principal residence substantially damaged or destroyed by a wildfire or natural disaster for which the Governor proclaimed a state of emergency._1': data.exclusions && data.exclusions.includes('disaster'),
      
      // Property Types
      'A. Type of property transferred': data.propertyType === 'single-family',
      'A. Type of property transferred1': data.propertyType === 'multi-family',
      'A. Type of property transferred2': data.propertyType === 'commercial',
      'A. Type of property transferred3': data.propertyType === 'condominium',
      'A. Type of property transferred4': data.propertyType === 'co-op',
      'A. Type of property transferred5': data.propertyType === 'manufactured',
      'A. Type of property transferred6': data.propertyType === 'unimproved',
      'A. Type of property transferred7': data.propertyType === 'timeshare',
      'A. Type of property transferred8': data.propertyType === 'other',
      
      // Transfer Type
      'B. Type of transfer': data.transferType === 'purchase',
      
      // Loan Types
      'C. First deed of trust': data.firstLoanType === 'new',
      'C. First deed of trust Bank/Savings': data.firstLoanSource === 'bank',
      'C. First deed of trust Loan Carried by seller': data.firstLoanSource === 'seller',
      'C. Balloon payment': data.hasFirstBalloon === 'yes',
      
      'D. Second deed of trust fixed rate': data.secondLoanRateType === 'fixed',
      'D. Second deed of trust variable rate': data.secondLoanRateType === 'variable',
      'D. Second deed of trust bank/savings & loan/credit union': data.secondLoanSource === 'bank',
      'D. Second deed of trust loan carried by seller': data.secondLoanSource === 'seller',
      'D. Balloon payment': data.hasSecondBalloon === 'yes',
      
      // Other Options
      'C. A manufactured home is included in the purchase price': data.manufacturedHome === 'yes',
      'C. The manufactured home is subject to local property tax': data.manufacturedHomeTax === 'yes',
      'D. The property produces rental or other income': data.hasRentalIncome === 'yes',
      'E. within the same county?': data.sameCounty === 'yes',
      'Within the same county?': data.sameCounty === 'no',
      'E. Was an improvement Bond or other public financing assumed by the buyer?': data.publicFinancing === 'yes',
      
      // Property Condition
      'E. The condition of the property at the time of sale was': data.propertyCondition === 'good',
      'E. The condition of the property at the time of sale was1': data.propertyCondition === 'average',
      'E. The condition of the property at the time of sale was2': data.propertyCondition === 'fair',
      'E. The condition of the property at the time of sale was3': data.propertyCondition === 'poor',
      
      // Income Sources
      'D. Income is from': data.incomeSource === 'commercial',
      'Income is from_1': data.incomeSource === 'residential',
      'Income is from‑2': data.incomeSource === 'farm',
      'Income is from_3': data.incomeSource === 'other',
    };
    
    // Set checkboxes
    for (const [fieldName, shouldCheck] of Object.entries(checkboxMappings)) {
      if (shouldCheck !== undefined) {
        try {
          const checkbox = form.getCheckBox(fieldName);
          if (shouldCheck) {
            checkbox.check();
          } else {
            checkbox.uncheck();
          }
          console.log((shouldCheck ? 'Checked' : 'Unchecked') + ' "' + fieldName + '"');
        } catch (e) {
          // Try case-insensitive match
          const foundField = fields.find(field => {
            const name = field.getName();
            return name && name.toLowerCase() === fieldName.toLowerCase() && 
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
              console.log((shouldCheck ? 'Checked' : 'Unchecked') + ' "' + foundField.getName() + '" (case-insensitive match)');
            } catch (e2) {
              console.log('Could not check/uncheck field "' + fieldName + '": ' + e2.message);
            }
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
