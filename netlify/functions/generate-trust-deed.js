const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const data = JSON.parse(event.body);
    console.log('Received data for trust deed:', data);
    
    // Load template
    const templateUrl = 'https://pcorautomation.netlify.app/templates/trust-transfer-deed-template.pdf';
    const response = await fetch(templateUrl);
    
    if (!response.ok) {
      throw new Error('Failed to load template: ' + response.statusText);
    }
    
    const templateBytes = await response.buffer();
    const pdfDoc = await PDFDocument.load(templateBytes);
    
    // Check if form exists
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    
    console.log('Template has ' + fields.length + ' fields');
    console.log('Field names:', fields.map(f => ({
      name: f.getName(),
      type: f.constructor.name
    })));
    
    // Format dates
    const today = new Date();
    const dateStr = formatDate(today);
    const trustDate = data.trustDate ? formatDate(new Date(data.trustDate)) : dateStr;
    
    // Build trust name
    const trustName = data.trustName || buildTrustName(data.grantor1Name, data.grantor2Name);
    
    // Build complete names and addresses
    const grantorNames = buildGrantorNames(data);
    const trusteeNames = buildTrusteeNames(data, trustName, trustDate);
    const mailingInfo = buildMailingInfo(data);
    
    // If no form fields, create text overlay
    if (fields.length === 0) {
      console.log('No form fields found, creating text overlay');
      await addTextOverlay(pdfDoc, {
        grantorNames,
        trusteeNames,
        trustName,
        propertyAddress: data.propertyAddress,
        propertyCity: data.propertyCity,
        propertyZip: data.propertyZip,
        apn: data.apn,
        legalDescription: data.legalDescription,
        mailingInfo,
        dateStr
      });
    } else {
      // Fill form fields with multiple name variations
      const fieldMappings = createFieldMappings(data, {
        trustName,
        grantorNames,
        trusteeNames,
        mailingInfo,
        dateStr,
        trustDate
      });
      
      let filledCount = fillFormFields(form, fields, fieldMappings);
      
      // Also try checkbox fields for transfer type
      filledCount += handleCheckboxes(form, fields, data);
      
      console.log(`Filled ${filledCount} fields`);
    }
    
    const pdfBytes = await pdfDoc.save();
    const base64 = Buffer.from(pdfBytes).toString('base64');
    
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        pdfUrl: `data:application/pdf;base64,${base64}`,
        message: `Trust deed generated successfully`
      })
    };
  } catch (error) {
    console.error('Error generating trust deed:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to generate trust deed',
        details: error.message 
      })
    };
  }
};

function formatDate(date) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function buildTrustName(grantor1, grantor2) {
  if (!grantor1) return 'LIVING TRUST';
  
  if (grantor2) {
    // Check if same last name
    const lastName1 = grantor1.split(' ').pop();
    const lastName2 = grantor2.split(' ').pop();
    if (lastName1 === lastName2) {
      return `${lastName1.toUpperCase()} FAMILY LIVING TRUST`;
    }
    return `${grantor1.toUpperCase()} AND ${grantor2.toUpperCase()} LIVING TRUST`;
  }
  
  return `${grantor1.toUpperCase()} LIVING TRUST`;
}

function buildGrantorNames(data) {
  let names = data.grantor1Name || '';
  if (data.grantor2Name) {
    names += ` AND ${data.grantor2Name}`;
  }
  if (data.ownershipType) {
    names += `, ${data.ownershipType}`;
  }
  return names;
}

function buildTrusteeNames(data, trustName, trustDate) {
  let names = '';
  if (data.grantor1Name) {
    names = data.grantor1Name;
    if (data.grantor2Name) {
      names += ` AND ${data.grantor2Name}`;
    }
    names += `, TRUSTEE${data.grantor2Name ? 'S' : ''} OF THE ${trustName}`;
    names += ` DATED ${trustDate}`;
  }
  return names;
}

function buildMailingInfo(data) {
  const name = data.grantor1Name + (data.grantor2Name ? ` AND ${data.grantor2Name}` : '');
  const address = data.mailingAddress || data.propertyAddress;
  const city = data.mailingCity || data.propertyCity;
  const state = data.mailingState || 'CA';
  const zip = data.mailingZip || data.propertyZip;
  
  return {
    name,
    address,
    cityStateZip: `${city}, ${state} ${zip}`,
    full: `${name}\n${address}\n${city}, ${state} ${zip}`
  };
}

function createFieldMappings(data, computed) {
  // Try many field name variations
  return {
    // Recording section variations
    'RECORDING REQUESTED BY': computed.trustName,
    'Recording Requested By': computed.trustName,
    'recording_requested_by': computed.trustName,
    'RecordingRequestedBy': computed.trustName,
    'recordingRequestedBy': computed.trustName,
    'Text1': computed.trustName,
    
    // Mail to section variations
    'WHEN RECORDED MAIL TO': computed.mailingInfo.full,
    'When Recorded Mail To': computed.mailingInfo.full,
    'mail_to_name': computed.mailingInfo.name,
    'WhenRecordedMailTo': computed.mailingInfo.full,
    'mailToName': computed.mailingInfo.name,
    'NAME': computed.mailingInfo.name,
    'Name': computed.mailingInfo.name,
    'Text2': computed.mailingInfo.full,
    
    // Address variations
    'ADDRESS': computed.mailingInfo.address,
    'Address': computed.mailingInfo.address,
    'mail_to_address': computed.mailingInfo.address,
    'mailToAddress': computed.mailingInfo.address,
    'StreetAddress': computed.mailingInfo.address,
    'Text3': computed.mailingInfo.address,
    
    // City/State/ZIP variations
    'CITY / STATE / ZIP': computed.mailingInfo.cityStateZip,
    'CityStateZip': computed.mailingInfo.cityStateZip,
    'mail_to_city_state_zip': computed.mailingInfo.cityStateZip,
    'Text4': computed.mailingInfo.cityStateZip,
    
    // Separate city, state, zip
    'CITY': data.mailingCity || data.propertyCity,
    'City': data.mailingCity || data.propertyCity,
    'STATE': data.mailingState || 'CA',
    'State': data.mailingState || 'CA',
    'ZIP': data.mailingZip || data.propertyZip,
    'Zip': data.mailingZip || data.propertyZip,
    'ZIP CODE': data.mailingZip || data.propertyZip,
    
    // APN variations
    'APN': data.apn,
    'apn': data.apn,
    'Apn': data.apn,
    'ParcelNumber': data.apn,
    'Parcel No': data.apn,
    'assessorsParcelNumber': data.apn,
    'Text5': data.apn,
    
    // Grantor variations
    'GRANTOR': computed.grantorNames,
    'Grantor': computed.grantorNames,
    'GRANTORS': computed.grantorNames,
    'Grantors': computed.grantorNames,
    'GRANTOR(S)': computed.grantorNames,
    'grantor_names': computed.grantorNames,
    'grantorNames': computed.grantorNames,
    'Text6': computed.grantorNames,
    
    // Grantee/Trustee variations
    'GRANTEE': computed.trusteeNames,
    'Grantee': computed.trusteeNames,
    'grantee_trust_name': computed.trusteeNames,
    'granteeTrustName': computed.trusteeNames,
    'Trustee': computed.trusteeNames,
    'TRUSTEE': computed.trusteeNames,
    'Text7': computed.trusteeNames,
    
    // Trust name alone
    'Trust Name': computed.trustName,
    'TRUST NAME': computed.trustName,
    'trust_name': computed.trustName,
    
    // Legal description variations
    'LEGAL DESCRIPTION': data.legalDescription,
    'Legal Description': data.legalDescription,
    'legal_description': data.legalDescription,
    'legalDescription': data.legalDescription,
    'LegalDesc': data.legalDescription,
    'the CITY OF County of State of CA, described as': data.legalDescription,
    'Text8': data.legalDescription,
    
    // Property address variations
    'PROPERTY ADDRESS': data.propertyAddress,
    'Property Address': data.propertyAddress,
    'property_address': data.propertyAddress,
    'propertyAddress': data.propertyAddress,
    'Commonly known as': data.propertyAddress,
    'CommonlyKnownAs': data.propertyAddress,
    'Text9': data.propertyAddress,
    
    // City and County
    'the CITY OF': data.propertyCity,
    'County of': 'Los Angeles',
    'State of': 'CA',
    
    // Date variations
    'DATE': computed.dateStr,
    'Date': computed.dateStr,
    'date': computed.dateStr,
    'ExecutionDate': computed.dateStr,
    'execution_date': computed.dateStr,
    'Dated': computed.dateStr,
    'Text10': computed.dateStr,
    
    // Tax statement variations
    'MAIL TAX STATEMENTS TO': computed.mailingInfo.full,
    'MailTaxStatementsTo': computed.mailingInfo.full,
    'tax_statements_to': computed.mailingInfo.full,
    'TaxStatements': computed.mailingInfo.full
  };
}

function fillFormFields(form, fields, fieldMappings) {
  let filledCount = 0;
  
  // Try each mapping
  for (const [fieldName, value] of Object.entries(fieldMappings)) {
    if (!value) continue;
    
    try {
      // Try exact match first
      const field = form.getTextField(fieldName);
      field.setText(value.toString());
      console.log(`✓ Filled field "${fieldName}"`);
      filledCount++;
    } catch (e1) {
      // Try case-insensitive search
      const foundField = fields.find(f => {
        const name = f.getName();
        return name && name.toLowerCase() === fieldName.toLowerCase() &&
               f.constructor.name.includes('TextField');
      });
      
      if (foundField) {
        try {
          const textField = form.getTextField(foundField.getName());
          textField.setText(value.toString());
          console.log(`✓ Filled field "${foundField.getName()}" (case-insensitive)`);
          filledCount++;
        } catch (e2) {
          // Field exists but couldn't be set
        }
      }
    }
  }
  
  return filledCount;
}

function handleCheckboxes(form, fields, data) {
  let checkedCount = 0;
  
  // Find all checkbox fields
  const checkboxes = fields.filter(f => f.constructor.name.includes('CheckBox'));
  console.log(`Found ${checkboxes.length} checkboxes`);
  
  // For trust transfer, check the box indicating transfer to revocable trust
  const trustCheckboxPatterns = [
    /revocable.*trust/i,
    /transfer.*grantor.*interest/i,
    /R&T.*11930/i,
    /section.*62/i
  ];
  
  for (const checkbox of checkboxes) {
    const name = checkbox.getName();
    if (!name) continue;
    
    for (const pattern of trustCheckboxPatterns) {
      if (pattern.test(name)) {
        try {
          const cb = form.getCheckBox(name);
          cb.check();
          console.log(`✓ Checked checkbox "${name}"`);
          checkedCount++;
          break;
        } catch (e) {
          console.log(`Could not check checkbox "${name}"`);
        }
      }
    }
  }
  
  return checkedCount;
}

async function addTextOverlay(pdfDoc, data) {
  const pages = pdfDoc.getPages();
  const firstPage = pages[0];
  const { width, height } = firstPage.getSize();
  
  // Embed font
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  // Add text at specific positions - ADJUSTED POSITIONS TO MOVE UP
  const textItems = [
    { text: data.trustName, x: 150, y: height - 120, font: font, size: 10 },
    { text: data.mailingInfo.name, x: 150, y: height - 150, font: font, size: 10 },
    { text: data.mailingInfo.address, x: 150, y: height - 165, font: font, size: 10 },
    { text: data.mailingInfo.cityStateZip, x: 150, y: height - 180, font: font, size: 10 },
    { text: `APN: ${data.apn}`, x: 120, y: height - 250, font: font, size: 10 },
    { text: 'TRUST TRANSFER DEED', x: 220, y: height - 290, font: boldFont, size: 14 },
    { text: `FOR A VALUABLE CONSIDERATION, ${data.grantorNames}`, x: 120, y: height - 330, font: font, size: 10 },
    { text: `hereby GRANT(S) to ${data.trusteeNames}`, x: 120, y: height - 345, font: font, size: 10 },
    { text: `the following described real property in ${data.propertyCity || 'Los Angeles'}, California:`, x: 120, y: height - 360, font: font, size: 10 },
    { text: data.legalDescription || '', x: 120, y: height - 390, font: font, size: 10, maxWidth: 450 },
    { text: `Commonly known as: ${data.propertyAddress}`, x: 120, y: height - 450, font: font, size: 10 },
    { text: `Dated: ${data.dateStr}`, x: 120, y: height - 480, font: font, size: 10 }
  ];
  
  for (const item of textItems) {
    if (!item.text) continue;
    
    if (item.maxWidth) {
      // Handle text wrapping for long text
      const lines = wrapText(item.text, item.font, item.size, item.maxWidth);
      let yPos = item.y;
      for (const line of lines) {
        firstPage.drawText(line, {
          x: item.x,
          y: yPos,
          size: item.size,
          font: item.font,
          color: rgb(0, 0, 0)
        });
        yPos -= item.size + 2;
      }
    } else {
      firstPage.drawText(item.text, {
        x: item.x,
        y: item.y,
        size: item.size,
        font: item.font,
        color: rgb(0, 0, 0)
      });
    }
  }
}

function wrapText(text, font, fontSize, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, fontSize);
    
    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  return lines;
}
