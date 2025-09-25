const pdf = require('pdf-parse');

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
    const { deed } = JSON.parse(event.body);
    const pdfBuffer = Buffer.from(deed, 'base64');
    
    // Extract text from PDF
    const pdfData = await pdf(pdfBuffer);
    const text = pdfData.text;
    
    console.log('Extracted text length:', text.length);
    
    // Extract information using regex patterns
    const extractedInfo = {
      // Extract grantee (who becomes grantor for trust deed)
      grantee: extractGrantee(text),
      grantor1: '',
      grantor2: '',
      
      // Extract property info
      propertyAddress: extractPropertyAddress(text),
      propertyCity: extractCity(text),
      propertyZip: extractZip(text),
      apn: extractAPN(text),
      legalDescription: extractLegalDescription(text),
      
      // Extract original grantor info
      originalGrantor: extractOriginalGrantor(text),
      
      // Parse grantee into grantor1 and grantor2
      ...parseGranteeIntoGrantors(extractGrantee(text))
    };
    
    console.log('Extracted info:', extractedInfo);
    
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        extractedInfo: extractedInfo
      })
    };
  } catch (error) {
    console.error('OCR Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false,
        error: error.message 
      })
    };
  }
};

// Extraction functions
function extractGrantee(text) {
  // Multiple patterns to catch different deed formats
  const patterns = [
    /hereby\s+GRANT(?:S)?\s+to\s+([^\n]+?)(?:\s+the\s+real\s+property)/is,
    /hereby\s+GRANT(?:S)?\s+to\s+([^,]+(?:,\s*[^,]+)?)\s*(?:,?\s*(?:husband|wife|as))/i,
    /hereby\s+remises[^:]+to\s+([^\n]+?)(?:\s+the\s+following)/i,
    /GRANT(?:S)?\s+to:\s*([^\n]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim().replace(/\s+/g, ' ');
    }
  }
  return '';
}

function extractPropertyAddress(text) {
  const patterns = [
    /(?:Commonly known as|Property Address)[:\s]*([0-9]+[^,\n]+)/i,
    /Address[:\s]*([0-9]+[^,\n]+)/i,
    /([0-9]+\s+[\w\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd)[^,\n]*)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const address = match[1].trim();
      // Clean up the address
      return address.split(',')[0].trim();
    }
  }
  return '';
}

function extractCity(text) {
  const patterns = [
    /(?:Commonly known as|Address)[:\s]*[^,]+,\s*([^,]+),\s*CA/i,
    /City of\s+([A-Za-z\s]+?)(?:,|\s+County)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return '';
}

function extractZip(text) {
  const pattern = /\b(9\d{4})\b/;
  const match = text.match(pattern);
  return match ? match[1] : '';
}

function extractAPN(text) {
  const patterns = [
    /APN[:\s]*([\d]{3}-[\d]{3}-[\d]{2})/i,
    /Parcel No[:\s]*([\d]{3}-[\d]{3}-[\d]{2})/i,
    /A\.P\.N[:\s]*([\d]{3}-[\d]{3}-[\d]{2})/i,
    /(?:APN|Parcel)[:\s]*([\d-]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return '';
}

function extractLegalDescription(text) {
  const patterns = [
    /Lot\s+\d+\s+of\s+Tract\s+No\.\s*\d+[^.]*\./i,
    /(?:PARCEL\s+\d+:|Legal Description:)\s*([^.]+\.)/i,
    /described as follows:\s*([^.]+\.)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return (match[1] || match[0]).trim();
    }
  }
  return '';
}

function extractOriginalGrantor(text) {
  const patterns = [
    /GRANTOR(?:\(S\))?[:\s]*([^\n]+)/i,
    /FOR A VALUABLE CONSIDERATION[^,]+,\s*([^,\n]+(?:\s+and\s+[^,\n]+)?)/i,
    /^([A-Z][A-Za-z\s]+(?:\s+and\s+[A-Z][A-Za-z\s]+)?)\s+hereby\s+GRANT/im
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return '';
}

function parseGranteeIntoGrantors(grantee) {
  if (!grantee) return { grantor1: '', grantor2: '' };
  
  // Split by AND
  const andPattern = /^([^,]+?)\s+(?:AND|and)\s+([^,]+?)(?:,|$)/;
  const match = grantee.match(andPattern);
  
  if (match) {
    return {
      grantor1: match[1].trim(),
      grantor2: match[2].trim()
    };
  }
  
  // If no AND, put all in grantor1
  return {
    grantor1: grantee.split(',')[0].trim(),
    grantor2: ''
  };
}
