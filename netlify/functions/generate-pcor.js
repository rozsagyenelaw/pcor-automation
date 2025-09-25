const { PDFDocument, rgb, StandardFonts, PDFName } = require('pdf-lib');

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
    
    console.log('=== FORM FIELD ANALYSIS ===');
    console.log('Total fields: ' + fields.length);
    
    // Analyze checkboxes in detail
    const allCheckboxes = fields.filter(field => field.constructor.name === 'PDFCheckBox');
    console.log('\n=== CHECKBOX ANALYSIS ===');
    console.log('Total checkboxes: ' + allCheckboxes.length);
    
    // List first 30 checkboxes with details
    console.log('\nFirst 30 checkbox details:');
    for (let i = 0; i < Math.min(30, allCheckboxes.length); i++) {
      const checkbox = allCheckboxes[i];
      const name = checkbox.getName();
      
      // Get the internal field reference
      const acroField = checkbox.acroField;
      const widgets = acroField.getWidgets();
      let states = 'N/A';
      let currentState = 'N/A';
      
      if (widgets && widgets.length > 0) {
        try {
          states = widgets[0].getAppearanceStates();
          const ap = widgets[0].getAppearances();
          currentState = widgets[0].getAppearanceState();
        } catch (e) {}
      }
      
      console.log(`[${i}] Name: "${name}"`);
      console.log(`     States: ${JSON.stringify(states)}`);
      console.log(`     Current: ${currentState}`);
    }
    
    const dateInfo = formatDate(data.transferDate);
    
    // Build complete addresses
    const buyerFullAddress = data.buyerAddress ? 
      `${data.buyerAddress}\n${data.buyerCity || ''}, ${data.buyerState || 'CA'} ${data.buyerZip || ''}` : '';
    
    const propertyFullAddress = data.propertyAddress ? 
      `${data.propertyAddress}, ${data.propertyCity || ''}, ${data.propertyState || 'CA'} ${data.propertyZip || ''}` : '';
    
    // Text field mappings (keeping these as they work)
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
    
    // NEW APPROACH FOR CHECKBOXES - Direct widget manipulation
    console.log('\n=== ATTEMPTING TO CHECK BOXES ===');
    
    // Check NO for principal residence (index 1)
    if (allCheckboxes.length > 1) {
      try {
        const checkbox = allCheckboxes[1];
        const widgets = checkbox.acroField.getWidgets();
        if (widgets && widgets.length > 0) {
          const widget = widgets[0];
          const states = widget.getAppearanceStates();
          console.log(`Principal Residence NO - Available states: ${JSON.stringify(states)}`);
          
          // Try different state values
          if (states && states.length > 0) {
            // Try the non-Off state (usually 'Yes', '1', 'On', or something else)
            const checkState = states.find(s => s !== 'Off') || states[1] || states[0];
            widget.setAppearanceState(checkState);
            console.log(`✓ Set Principal Residence NO to state: ${checkState}`);
          }
        }
      } catch (e) {
        console.log('✗ Failed to check Principal Residence NO: ' + e.message);
      }
    }
    
    // Check NO for disabled veteran (index 3)
    if (allCheckboxes.length > 3) {
      try {
        const checkbox = allCheckboxes[3];
        const widgets = checkbox.acroField.getWidgets();
        if (widgets && widgets.length > 0) {
          const widget = widgets[0];
          const states = widget.getAppearanceStates();
          console.log(`Disabled Veteran NO - Available states: ${JSON.stringify(states)}`);
          
          if (states && states.length > 0) {
            const checkState = states.find(s => s !== 'Off') || states[1] || states[0];
            widget.setAppearanceState(checkState);
            console.log(`✓ Set Disabled Veteran NO to state: ${checkState}`);
          }
        }
      } catch (e) {
        console.log('✗ Failed to check Disabled Veteran NO: ' + e.message);
      }
    }
    
    // Check YES for Section L (try multiple indices)
    const sectionLIndices = [22, 23, 24, 25, 26, 27, 28];
    for (const idx of sectionLIndices) {
      if (idx < allCheckboxes.length) {
        try {
          const checkbox = allCheckboxes[idx];
          const name = checkbox.getName() || '';
          
          // Check if this might be Section L
          if (name.toLowerCase().includes('trust') || 
              name.toLowerCase().includes('revocable') || 
              name.toLowerCase().includes('l1') ||
              idx === 24) { // Often Section L is around index 24
            
            const widgets = checkbox.acroField.getWidgets();
            if (widgets && widgets.length > 0) {
              const widget = widgets[0];
              const states = widget.getAppearanceStates();
              console.log(`Section L [${idx}] - Available states: ${JSON.stringify(states)}`);
              
              if (states && states.length > 0) {
                const checkState = states.find(s => s !== 'Off') || states[1] || states[0];
                widget.setAppearanceState(checkState);
                console.log(`✓ Set Section L to state: ${checkState} at index ${idx}`);
                break; // Stop after first successful L section
              }
            }
          }
        } catch (e) {
          console.log(`✗ Failed at index ${idx}: ${e.message}`);
        }
      }
    }
    
    // Alternative method: Try using the form's check method with error handling
    console.log('\n=== ALTERNATIVE CHECK METHOD ===');
    try {
      // Try to check specific boxes by index using form method
      const checkIndices = [1, 3, 24]; // NO principal, NO veteran, YES section L
      
      for (const idx of checkIndices) {
        if (idx < allCheckboxes.length) {
          const checkboxName = allCheckboxes[idx].getName();
          try {
            const cb = form.getCheckBox(checkboxName);
            cb.check();
            console.log(`✓ Checked box at index ${idx} using form.check()`);
          } catch (e) {
            // Try toggle if check doesn't work
            try {
              const cb = form.getCheckBox(checkboxName);
              cb.uncheck(); // First uncheck
              cb.check();   // Then check
              console.log(`✓ Toggled box at index ${idx}`);
            } catch (e2) {
              console.log(`✗ Could not check/toggle box at index ${idx}`);
            }
          }
        }
      }
    } catch (e) {
      console.log('Alternative method error: ' + e.message);
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
        message: 'PCOR form generated with diagnostic logging'
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
