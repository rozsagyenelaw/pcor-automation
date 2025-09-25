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
    
    console.log('PDF text extracted, first 500 chars:', text.substring(0, 500));
    
    // Extract information with improved patterns
    const grantee = extractGrantee(text);
    const grantorNames = parseGranteeIntoGrantors(grantee);
    const propertyAddress = extractPropertyAddress(text);
    const apn = extractAPN(text);
    const legalDesc = extractLegalDescription(text);
    
    const extractedInfo = {
      grantee: grantee,
      grantor1: grantorNames.grantor1,
      grantor2: grantorNames.grantor2,
      propertyAddress: propertyAddress,
      propertyCity: extractCity(text, propertyAddress),
      propertyZip: extractZip(text),
      apn: apn,
      legalDescription: legalDesc,
      originalGrantor: extractOriginalGrantor(text),
    };
    
    console.log('Extracted info:', JSON.stringify(extractedInfo, null, 2));
    
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

// Extract grantee - this becomes the grantor for trust deed
function extractGrantee(text) {
  const patterns = [
    // Pattern for "GRANT(s) to NAME AND NAME"
    /GRANT(?:S)?\s+to\s+([A-Z][A-Z\s\.\-]+?(?:\s+(?:AND|and)\s+[A-Z][A-Z\s\.\-]+)?)\s*,?\s*(?:husband|wife|Husband|Wife|as\s+Joint\s+Tenants|$/mi,
    // Pattern for "hereby GRANT to"
    /hereby\s+GRANT(?:S)?\s+to\s+([A-Z][A-Z\s\.\-]+?(?:\s+(?:AND|and)\s+[A-Z][A-Z\s\.\-]+)?)\s*,?\s*(?:husband|wife|Husband|Wife|as\s+Joint\s+Tenants|$/mi,
    // Pattern with line breaks
    /GRANT(?:S)?\s+to:?\s*\n?\s*([A-Z][A-Z\s\.\-]+?(?:\s+(?:AND|and)\s+[A-Z][A-Z\s\.\-]+)?)\s*,?\s*(?:husband|wife|Husband|Wife|as\s+Joint\s+Tenants|$/mi
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let grantee = match[1].trim();
      // Clean up
      grantee = grantee.replace(/\s+/g, ' ');
      grantee = grantee.replace(/,?\s*$/, '');
      console.log('Found grantee:', grantee);
      return grantee;
    }
  }
  
  // Try to find names after "GRANT to"
  const grantIndex = text.search(/GRANT(?:S)?\s+to/i);
  if (grantIndex !== -1) {
    const afterGrant = text.substring(grantIndex + 10, grantIndex + 200);
    console.log('Text after GRANT to:', afterGrant);
    // Extract uppercase names
    const nameMatch = afterGrant.match(/([A-Z][A-Z\s\.\-]+(?:\s+(?:AND|and)\s+[A-Z][A-Z\s\.\-]+)?)/);
    if (nameMatch) {
      return nameMatch[1].trim();
    }
  }
  
  return '';
}

// Extract property address
function extractPropertyAddress(text) {
  const patterns = [
    // Look for address with number and street
    /([0-9]+\s+[A-Z][a-zA-Z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Boulevard|Blvd|Circle|Cir|Trail|Tr)\.?)\s*,?\s*([A-Za-z\s]+,?\s*CA)/i,
    // Commonly known as
    /Commonly\s+known\s+as:?\s*([0-9]+[^,\n]+)/i,
    // After APN sometimes
    /(?:property|real\s+property|described\s+as|located\s+at)[:\s]+([0-9]+[^,\n]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const address = match[1].trim();
      console.log('Found property address:', address);
      return address;
    }
  }
  return '';
}

// Extract APN
function extractAPN(text) {
  const patterns = [
    // Standard format XXX-XXX-XX
    /(?:APN|A\.P\.N\.?|Assessor'?s?\s+Parcel\s+Number)[:\s]*([\d]{3}[\-\s][\d]{3}[\-\s][\d]{2,3})/i,
    // With different separators
    /(?:APN|Parcel\s+No\.?)[:\s]*([\d]{3}[\-\s][\d]{3}[\-\s][\d]{2,3})/i,
    // Order No that might be APN
    /(?:Order\s+No\.?|APN)[:\s]*([\d]{3}[\-\s][\d]{3}[\-\s][\d]{2,3})/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const apn = match[1].replace(/\s/g, '-');
      console.log('Found APN:', apn);
      return apn;
    }
  }
  
  // Try finding any XXX-XXX-XX pattern
  const genericPattern = /\b([\d]{3}[\-\s][\d]{3}[\-\s][\d]{2,3})\b/;
  const match = text.match(genericPattern);
  if (match) {
    return match[1].replace(/\s/g, '-');
  }
  
  return '';
}

// Extract legal description
function extractLegalDescription(text) {
  const patterns = [
    // Lot X of Tract No. XXXX
    /(Lot\s+[\d]+\s+of\s+Tract\s+No\.?\s*[\d]+[^\.]*(?:Book|Page)[^\.]*\.)/i,
    // Simpler Lot of Tract
    /(Lot\s+[\d]+\s+of\s+Tract\s+(?:No\.?\s*)?[\d]+[^\.]*\.)/i,
    // After "described as"
    /(?:described\s+as|legal\s+description)[:\s]*([^\.]+\.)/i,
    // COMPLETE LEGAL DESCRIPTION
    /(?:COMPLETE\s+)?LEGAL\s+DESCRIPTION[:\s]*([^\.]+\.)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const desc = match[1] || match[0];
      console.log('Found legal description:', desc);
      return desc.trim();
    }
  }
  return '';
}

// Extract city from text or address
function extractCity(text, address) {
  // Try to extract from address first
  if (address) {
    const addressParts = address.split(',');
    if (addressParts.length > 1) {
      return addressParts[1].trim().replace(/,?\s*CA.*$/, '');
    }
  }
  
  // Look for city patterns
  const patterns = [
    /(?:City\s+of\s+)([A-Za-z\s]+?)(?:,|\s+County)/i,
    /([A-Za-z\s]+?),\s*CA\s+9\d{4}/i
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

// Extract original grantor
function extractOriginalGrantor(text) {
  const patterns = [
    /FOR\s+A\s+VALUABLE\s+CONSIDERATION[^,]*,\s*([A-Z][A-Z\s\.\-]+(?:\s+and\s+[A-Z][A-Z\s\.\-]+)?)/i,
    /^\s*([A-Z][A-Z\s\.\-]+(?:\s+and\s+[A-Z][A-Z\s\.\-]+)?)\s+hereby\s+GRANT/mi
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
  
  // Look for AND between names
  const andPatterns = [
    /^(.+?)\s+(?:AND|and)\s+(.+)$/,
    /^([A-Z\s\.\-]+)\s+(?:AND|and)\s+([A-Z\s\.\-]+)$/
  ];
  
  for (const pattern of andPatterns) {
    const match = grantee.match(pattern);
    if (match) {
      return {
        grantor1: match[1].trim(),
        grantor2: match[2].trim()
      };
    }
  }
  
  // No AND found, put all in grantor1
  return {
    grantor1: grantee,
    grantor2: ''
  };
}
