const { PDFDocument } = require('pdf-lib');
const fetch = require('node-fetch');

async function fillTrustDeed(data) {
  // Load template
  const templateUrl = 'https://pcorautomation.netlify.app/templates/trust-transfer-deed-template.pdf';
  const response = await fetch(templateUrl);
  const templateBytes = await response.buffer();
  
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();
  
  // Format date
  const today = new Date();
  const dateStr = `${today.getMonth()+1}/${today.getDate()}/${today.getFullYear()}`;
  
  // Fill fields
  const fieldMappings = {
    'recording_requested_by': data.trustName || `${data.grantor1Name} AND ${data.grantor2Name} LIVING TRUST`,
    'mail_to_name': data.grantor1Name,
    'mail_to_address': data.mailingAddress,
    'mail_to_city_state_zip': `${data.mailingCity}, ${data.mailingState} ${data.mailingZip}`,
    'apn': data.apn,
    'grantor_names': `${data.grantor1Name} AND ${data.grantor2Name}, ${data.ownershipType}`,
    'grantee_trust_name': `${data.grantor1Name} AND ${data.grantor2Name}, TRUSTEE OF THE ${data.trustName} DATED ${dateStr}`,
    'legal_description': data.legalDescription,
    'property_address': data.propertyAddress,
    'execution_date': dateStr,
    'tax_statements_to': `${data.grantor1Name} AND ${data.grantor2Name}\n${data.mailingAddress}\n${data.mailingCity}, ${data.mailingState} ${data.mailingZip}`
  };
  
  for (const [fieldName, value] of Object.entries(fieldMappings)) {
    if (value) {
      try {
        const field = form.getTextField(fieldName);
        field.setText(value.toString());
      } catch (e) {
        console.log(`Field not found: ${fieldName}`);
      }
    }
  }
  
  return await pdfDoc.save();
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }
  
  try {
    const data = JSON.parse(event.body);
    const pdfBytes = await fillTrustDeed(data);
    const base64 = Buffer.from(pdfBytes).toString('base64');
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        pdfUrl: `data:application/pdf;base64,${base64}`
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
