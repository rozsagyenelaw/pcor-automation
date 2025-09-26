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
    
    console.log('Extracted text length:', text.length);
    console.log('First 1000 chars:', text.substring(0, 1000));
    
    // Use improved extraction methods
    const extractedInfo = extractComprehensiveInfo(text);
    
    console.log('Extracted info:', JSON.stringify(extractedInfo, null, 2));
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        extractedInfo: extractedInfo,
        rawText: text.substring(0, 2000) // Send first 2000 chars for debugging
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

function extractComprehensiveInfo(text) {
  // Clean up text for better matching
  const cleanText = text.replace(/\s+/g, ' ').trim();
  
  const info = {
    grantee: '',
    grantor1: '',
    grantor2: '',
    propertyAddress: '',
    propertyCity: '',
    propertyState: 'CA',
    propertyZip: '',
    apn: '',
    legalDescription: '',
    originalGrantor: '',
    recordingInfo: extractRecordingInfo(cleanText),
    documentType: extractDocumentType(cleanText)
  };
  
  // Extract names with multiple strategies
  const names = extractNames(cleanText);
  if (names.grantee) {
    info.grantee = names.grantee;
    const parsed = parseNameIntoTwo(names.grantee);
    info.grantor1 = parsed.name1;
    info.grantor2 = parsed.name2;
  }
  
  // Extract property info
  const propInfo = extractPropertyInfo(cleanText);
  Object.assign(info, propInfo);
  
  // Extract APN with multiple patterns
  info.apn = extractAPNComprehensive(cleanText);
  
  // Extract legal description
  info.legalDescription = extractLegalDescComprehensive(cleanText);
  
  // Extract original grantor if available
  info.originalGrantor = names.grantor || '';
  
  return info;
}

function extractNames(text) {
  const result = { grantor: '', grantee: '' };
  
  // Strategy 1: Look for "GRANT to" pattern
  const grantToPatterns = [
    /(?:hereby\s+)?GRANTS?\s+to[:;\s]+([A-Z][A-Za-z\s,\.]+?)(?:\s*,\s*(?:a|an|as|husband|wife|married|single|unmarried))/i,
    /(?:hereby\s+)?GRANTS?\s+to[:;\s]+([A-Z][A-Za-z\s,\.]+?)\s*(?:,|\n|$)/i,
    /to\s+([A-Z][A-Z\s\.]+(?:AND|and|&)\s+[A-Z][A-Z\s\.]+)/,
    /Grantee[:;\s]+([A-Za-z\s,\.]+?)(?:\n|,\s*a)/i
  ];
  
  for (const pattern of grantToPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.grantee = cleanName(match[1]);
      console.log('Found grantee with pattern:', result.grantee);
      break;
    }
  }
  
  // Strategy 2: Look for grantor patterns
  const grantorPatterns = [
    /^([A-Z][A-Za-z\s,\.]+?)\s+(?:hereby\s+)?GRANTS?/mi,
    /Grantor[:;\s]+([A-Za-z\s,\.]+?)(?:\n|,\s*a)/i,
    /FOR\s+(?:A\s+)?VALUABLE\s+CONSIDERATION[^,]*,\s*([A-Z][A-Za-z\s,\.]+?)\s+(?:hereby|GRANT)/i
  ];
  
  for (const pattern of grantorPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.grantor = cleanName(match[1]);
      console.log('Found grantor with pattern:', result.grantor);
      break;
    }
  }
  
  // Strategy 3: Look for structured name blocks
  if (!result.grantee) {
    // Look for names after "WHEN RECORDED MAIL TO"
    const mailToMatch = text.match(/WHEN\s+RECORDED\s+MAIL\s+TO[:;\s]+([A-Za-z\s,\.]+?)(?:\n|,)/i);
    if (mailToMatch) {
      const possibleName = cleanName(mailToMatch[1]);
      if (possibleName && possibleName.length > 5) {
        result.grantee = possibleName;
        console.log('Found grantee from mail-to section:', result.grantee);
      }
    }
  }
  
  return result;
}

function extractPropertyInfo(text) {
  const info = {
    propertyAddress: '',
    propertyCity: '',
    propertyZip: ''
  };
  
  // Extract address
  const addressPatterns = [
    // Standard address with street type
    /(\d+\s+[A-Za-z\s]+?(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Boulevard|Blvd|Circle|Cir|Parkway|Pkwy|Trail|Path)\.?)(?:\s*,\s*([A-Za-z\s]+?))?(?:\s*,\s*CA)?(?:\s+(\d{5}))?/i,
    // "Commonly known as" pattern
    /Commonly\s+known\s+as[:;\s]+([^\n]+?)(?:\n|$)/i,
    // "Real property" pattern
    /(?:Real\s+property|Property)\s+(?:located\s+)?(?:at|in)[:;\s]+([^\n]+?)(?:\n|$)/i,
    // Property address label
    /Property\s+Address[:;\s]+([^\n]+?)(?:\n|$)/i
  ];
  
  for (const pattern of addressPatterns) {
    const match = text.match(pattern);
    if (match) {
      info.propertyAddress = cleanAddress(match[1]);
      if (match[2]) info.propertyCity = cleanCity(match[2]);
      if (match[3]) info.propertyZip = match[3];
      console.log('Found property address:', info.propertyAddress);
      break;
    }
  }
  
  // Try to extract city if not found
  if (!info.propertyCity) {
    const cityPatterns = [
      /(?:City\s+of\s+)([A-Za-z\s]+?)(?:,|\s+County)/i,
      /([A-Za-z\s]+?),\s*CA\s+\d{5}/i,
      /in\s+([A-Za-z\s]+?)\s+County/i
    ];
    
    for (const pattern of cityPatterns) {
      const match = text.match(pattern);
      if (match) {
        info.propertyCity = cleanCity(match[1]);
        console.log('Found city:', info.propertyCity);
        break;
      }
    }
  }
  
  // Extract ZIP if not found
  if (!info.propertyZip) {
    const zipMatch = text.match(/\b(9\d{4})\b/);
    if (zipMatch) {
      info.propertyZip = zipMatch[1];
      console.log('Found ZIP:', info.propertyZip);
    }
  }
  
  return info;
}

function extractAPNComprehensive(text) {
  const patterns = [
    // Standard APN formats
    /(?:APN|A\.P\.N\.|Assessor'?s?\s+Parcel\s+(?:Number|No\.?))[:;\s]*([\d]{3,4}[-\s][\d]{3,4}[-\s][\d]{2,3})/i,
    /(?:Parcel\s+(?:Number|No\.?))[:;\s]*([\d]{3,4}[-\s][\d]{3,4}[-\s][\d]{2,3})/i,
    // Sometimes appears as just numbers
    /\b([\d]{3,4}[-\s][\d]{3,4}[-\s][\d]{2,3})\b/,
    // May have different separators
    /(?:APN)[:;\s]*([\d]{3,4}[\s\-\.]+[\d]{3,4}[\s\-\.]+[\d]{2,3})/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const apn = match[1].replace(/[\s\.]+/g, '-');
      console.log('Found APN:', apn);
      return apn;
    }
  }
  
  return '';
}

function extractLegalDescComprehensive(text) {
  const patterns = [
    // Lot and Tract patterns
    /(Lot\s+\d+[^\.]*?Tract\s+(?:No\.?\s*)?\d+[^\.]*?(?:Book|Page|recorded)[^\.]*?\.)/i,
    // Lot/Block patterns
    /(Lot\s+\d+[^\.]*?Block\s+\d+[^\.]*?\.)/i,
    // Legal description section
    /Legal\s+Description[:;\s]+([^\.]+(?:\.[^\.]+){0,2}\.)/i,
    // Described as section
    /(?:described\s+as|more\s+particularly\s+described\s+as)[:;\s]+([^\.]+(?:\.[^\.]+){0,2}\.)/i,
    // Full legal description block
    /(?:LEGAL\s+DESCRIPTION|EXHIBIT\s+[A-Z])[\s\S]{0,50}?((?:Lot|Parcel|Tract|That\s+certain)[^\.]+(?:\.[^\.]+){0,3}\.)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const desc = cleanLegalDescription(match[1] || match[0]);
      console.log('Found legal description:', desc.substring(0, 100));
      return desc;
    }
  }
  
  return '';
}

function extractRecordingInfo(text) {
  const info = {};
  
  // Recording date
  const dateMatch = text.match(/(?:Recorded|Recording\s+Date)[:;\s]+(\w+\s+\d{1,2},?\s+\d{4})/i);
  if (dateMatch) {
    info.recordingDate = dateMatch[1];
  }
  
  // Document/Instrument number
  const docMatch = text.match(/(?:Document|Instrument)\s+(?:Number|No\.?)[:;\s]+([\d\-]+)/i);
  if (docMatch) {
    info.documentNumber = docMatch[1];
  }
  
  return info;
}

function extractDocumentType(text) {
  const types = [
    'GRANT DEED',
    'WARRANTY DEED',
    'QUITCLAIM DEED',
    'TRUST DEED',
    'DEED OF TRUST',
    'INTERSPOUSAL TRANSFER DEED'
  ];
  
  for (const type of types) {
    if (text.toUpperCase().includes(type)) {
      return type;
    }
  }
  
  return 'DEED';
}

function parseNameIntoTwo(fullName) {
  if (!fullName) return { name1: '', name2: '' };
  
  // Clean the name first
  fullName = fullName.trim();
  
  // Look for AND, and, or & separators
  const separators = [
    /\s+AND\s+/i,
    /\s+&\s+/,
    /\s*,\s+/
  ];
  
  for (const sep of separators) {
    if (sep.test(fullName)) {
      const parts = fullName.split(sep);
      if (parts.length >= 2) {
        return {
          name1: cleanName(parts[0]),
          name2: cleanName(parts[1])
        };
      }
    }
  }
  
  // Check if it's a couple with same last name
  const words = fullName.split(/\s+/);
  if (words.length >= 4) {
    // Might be "FIRST1 LAST and FIRST2 LAST" format
    const midPoint = Math.floor(words.length / 2);
    return {
      name1: words.slice(0, midPoint).join(' '),
      name2: words.slice(midPoint).join(' ')
    };
  }
  
  // Single name
  return {
    name1: fullName,
    name2: ''
  };
}

// Helper functions
function cleanName(name) {
  if (!name) return '';
  return name
    .replace(/\s+/g, ' ')
    .replace(/,\s*$/, '')
    .replace(/\b(husband|wife|married|single|unmarried|trustee|successor|trust)\b.*/i, '')
    .trim();
}

function cleanAddress(address) {
  if (!address) return '';
  return address
    .replace(/\s+/g, ' ')
    .replace(/,\s*$/, '')
    .trim();
}

function cleanCity(city) {
  if (!city) return '';
  return city
    .replace(/\s+/g, ' ')
    .replace(/,.*$/, '')
    .replace(/\s*County.*$/i, '')
    .trim();
}

function cleanLegalDescription(desc) {
  if (!desc) return '';
  return desc
    .replace(/\s+/g, ' ')
    .replace(/\n/g, ' ')
    .substring(0, 500)
    .trim();
}
