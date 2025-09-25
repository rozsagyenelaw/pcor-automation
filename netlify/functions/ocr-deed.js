const pdf = require('pdf-parse');

async function extractDeedInfo(pdfBuffer) {
  const data = await pdf(pdfBuffer);
  const text = data.text;
  
  return {
    grantee: extractGrantee(text),
    propertyAddress: extractPropertyAddress(text),
    apn: extractAPN(text),
    legalDescription: extractLegalDescription(text),
    grantor1: '', // Will be parsed from grantee
    grantor2: ''
  };
}

function extractGrantee(text) {
  const pattern = /hereby\s+GRANT(?:S)?\s+to\s+([^,\n]+(?:,\s*[^,\n]+)?)/i;
  const match = text.match(pattern);
  if (match) {
    const names = match[1].trim();
    // Split names if "AND" present
    if (names.includes(' AND ') || names.includes(' and ')) {
      const parts = names.split(/\s+(?:AND|and)\s+/);
      return {
        grantor1: parts[0].trim(),
        grantor2: parts[1] ? parts[1].trim() : ''
      };
    }
    return { grantor1: names, grantor2: '' };
  }
  return { grantor1: '', grantor2: '' };
}

function extractPropertyAddress(text) {
  const pattern = /(?:Commonly known as:|Address:)\s*([^\n]+)/i;
  const match = text.match(pattern);
  return match ? match[1].trim() : '';
}

function extractAPN(text) {
  const pattern = /APN:?\s*([\d-]+)/i;
  const match = text.match(pattern);
  return match ? match[1] : '';
}

function extractLegalDescription(text) {
  const pattern = /Lot\s+\d+\s+of\s+Tract[^.]+\./i;
  const match = text.match(pattern);
  return match ? match[0] : '';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  
  try {
    const formData = JSON.parse(event.body);
    const pdfBuffer = Buffer.from(formData.deed, 'base64');
    const extractedData = await extractDeedInfo(pdfBuffer);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(extractedData)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
