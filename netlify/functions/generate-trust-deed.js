const { PDFDocument } = require('pdf-lib');
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
    const form = pdfDoc.getForm();
    
    // Get all fields to see what's available
    const fields = form.getFields();
    console.log('Available form fields:', fields.map(f => f.getName()));
    
    // Format today's date
    const today = new Date();
    const dateStr = `${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getDate().toString().padStart(2, '0')}/${today.getFullYear()}`;
    
    // Build trust name if not provided
    const trustName = data.trustName || `${data.grantor1Name} AND ${data.grantor2Name} LIVING TRUST`;
    
    // Fill the form - try multiple field name variations
    const fieldMappings = {
      // Try different field name patterns
      'RECORDING REQUESTED BY': trustName,
      'Recording Requested By': trustName,
      'recording_requested_by': trustName,
      
      'WHEN RECORDED MAIL TO': data.grantor1Name,
      'When Recorded Mail To': data.grantor1Name,
      'mail_to_name': data.grantor1Name,
      'NAME': data.grantor1Name,
      
      'ADDRESS': data.mailingAddress,
      'mail_to_address': data.mailingAddress,
      
      'CITY / STATE / ZIP': `${data.mailingCity}, ${data.mailingState} ${data.mailingZip}`,
      'mail_to_city_state_zip': `${data.mailingCity}, ${data.mailingState} ${data.mailingZip}`,
      
      'APN': data.apn,
      'apn': data.apn,
      'Parcel No': data.apn,
      
      // Grantor field
      'GRANTOR(S)': `${data.grantor1Name} AND ${data.grantor2Name}, ${data.ownershipType || 'HUSBAND AND WIFE AS JOINT TENANTS'}`,
      'grantor_names': `${data.grantor1Name} AND ${data.grantor2Name}, ${data.ownershipType || 'HUSBAND AND WIFE AS JOINT TENANTS'}`,
      
      // Grantee field (the trust)
      'grantee_trust_name': `${data.grantor1Name} AND ${data.grantor2Name}, TRUSTEE OF THE ${trustName} DATED ${dateStr}, AND ANY AMENDMENTS THERETO`,
      
      // Legal description
      'legal_description': data.legalDescription,
      'Legal Description': data.legalDescription,
      
      // Property address
      'property_address': `Commonly known as: ${data.propertyAddress}`,
      'Property Address': data.propertyAddress,
      
      // Date
      'Date': dateStr,
      'execution_date': dateStr,
      'Dated': dateStr,
      
      // Mail tax statements
      'MAIL TAX STATEMENTS TO': `${data.grantor1Name} AND ${data.grantor2Name}\n${data.mailingAddress}\n${data.mailingCity}, ${data.mailingState} ${data.mailingZip}`,
      'tax_statements_to': `${data.grantor1Name} AND ${data.grantor2Name}\n${data.mailingAddress}\n${data.mailingCity}, ${data.mailingState} ${data.mailingZip}`
    };
    
    // Try to fill each field
    let filledCount = 0;
    for (const [fieldName, value] of Object.entries(fieldMappings)) {
      if (value) {
        try {
          const field = form.getTextField(fieldName);
          field.setText(value.toString());
          console.log(`✓ Filled field "${fieldName}"`);
          filledCount++;
        } catch (e) {
          // Field not found with this name, try next
        }
      }
    }
    
    console.log(`Filled ${filledCount} fields out of ${Object.keys(fieldMappings).length} attempted`);
    
    const pdfBytes = await pdfDoc.save();
    const base64 = Buffer.from(pdfBytes).toString('base64');
    
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        pdfUrl: `data:application/pdf;base64,${base64}`,
        message: `Trust deed generated with ${filledCount} fields filled`
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
