const pdf = require('pdf-parse');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers, 
      body: JSON.stringify({ error: 'Method Not Allowed' }) 
    };
  }

  try {
    const { deed } = JSON.parse(event.body);
    
    if (!deed) {
      throw new Error('No deed data provided');
    }
    
    const pdfBuffer = Buffer.from(deed, 'base64');
    
    // Extract text from PDF
    const pdfData = await pdf(pdfBuffer);
    const text = pdfData.text;
    
    console.log('PDF text extracted, length:', text.length);
    
    // Extract information
    const grantee = extractGrantee(text);
    const grantorNames = parseGranteeIntoGrantors(grantee);
    
    const extractedInfo = {
      grantee: grantee,
      grantor1: grantorNames.grantor1,
      grantor2: grantorNames.grantor2,
      propertyAddress: extractPropertyAddress(text),
      propertyCity: extractCity(text),
      propertyZip: extractZip(text),
      apn: extractAPN(text),
      legalDescription: extractLegalDescription(text),
      originalGrantor: extractOriginalGrantor(text),
    };
    
    console.log('Extracted info:', extractedInfo);
    
    return {
      statusCode: 200,
      headers,
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

// Extract grantee (becomes grantor for trust deed)
function extractGrantee(text) {
  const patterns = [
    /hereby\s+GRANT(?:S)?\s+to\s+([A-Z][A-Z\s\.]+?(?:\s+(?:AND|and)\s+[A-Z][A-Z\s\.]+)?)/,
    /GRANT(?:S)?\s+to:\s*([^\n]+)/i,
    /hereby\s+remises[^:]+to\s+([A-Z][A-Z\s\.]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let grantee = match[1].trim();
      // Remove trailing relationship descriptors
      grantee = grantee.replace(/,?\s*(?:husband|wife|Husband|Wife|as Joint Tenants).*$/i, '').trim();
      return grantee;
    }
  }
  return '';
}

// Extract property address
function extractPropertyAddress(text) {
  const patterns = [
    /(?:Commonly known as:|Property Address:)\s*([0-9]+[^,\n]+)/i,
    /([0-9]+\s+[\w\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Boulevard|Blvd|Parkway|Pkwy|Circle|Cir)[^,\n]*)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return '';
}

// Extract city
function extractCity(text) {
  const patterns = [
    /(?:City of\s+)([A-Za-z\s]+?)(?:,|\s+County)/i,
    /(?:Commonly known as:|Address:)[^,]+,\s*([^,]+),\s*CA/i,
    /([A-Za-z\s]+),\s*CA\s+9\d{4}/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return '';
}

// Extract ZIP code
function extractZip(text) {
  const pattern = /\b(9\d{4})\b/;
  const match = text.match(pattern);
  return match ? match[1] : '';
}

// Extract APN
function extractAPN(text) {
  const patterns = [
    /(?:APN|A\.P\.N\.?)[:\s]*([\d]{3}-[\d]{3}-[\d]{2})/i,
    /(?:Parcel No\.?)[:\s]*([\d]{3}-[\d]{3}-[\d]{2})/i,
    /(?:APN|A\.P\.N|Parcel)[:\s]*([\d-]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return '';
}

// Extract legal description
function extractLegalDescription(text) {
  const patterns = [
    /(Lot\s+\d+\s+of\s+Tract\s+No\.\s*\d+[^.]*\.)/i,
    /(?:Legal Description:)\s*([^.]+\.)/i,
    /(?:described as follows:)\s*([^.]+\.)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return '';
}

// Extract original grantor
function extractOriginalGrantor(text) {
  const patterns = [
    /FOR A VALUABLE CONSIDERATION[^,]*,\s*([A-Z][A-Z\s\.]+(?:\s+and\s+[A-Z][A-Z\s\.]+)?)/,
    /^\s*([A-Z][A-Z\s\.]+(?:\s+and\s+[A-Z][A-Z\s\.]+)?)\s+hereby\s+GRANT/m
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let grantor = match[1].trim();
      grantor = grantor.replace(/,?\s*(?:husband|wife|Husband|Wife).*$/i, '').trim();
      return grantor;
    }
  }
  return '';
}

// Parse grantee into two grantors
function parseGranteeIntoGrantors(grantee) {
  if (!grantee) return { grantor1: '', grantor2: '' };
  
  // Split by AND
  const andMatch = grantee.match(/^(.+?)\s+(?:AND|and)\s+(.+)$/);
  
  if (andMatch) {
    return {
      grantor1: andMatch[1].trim(),
      grantor2: andMatch[2].trim()
    };
  }
  
  // No AND found, put all in grantor1
  return {
    grantor1: grantee,
    grantor2: ''
  };
}
