
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
    let text = pdfData.text;
    
    console.log('PDF pages:', pdfData.numpages);
    console.log('Text length:', text.length);
    console.log('First 500 chars:', text.substring(0, 500));
    
    // Clean up the text
    text = cleanText(text);
    
    // Extract comprehensive information
    const extractedInfo = extractAllInfo(text);
    
    console.log('Extracted info:', JSON.stringify(extractedInfo, null, 2));
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        extractedInfo: extractedInfo,
        rawText: text.substring(0, 2000),
        debug: {
          pages: pdfData.numpages,
          textLength: text.length
        }
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

function cleanText(text) {
  // Clean up common PDF extraction issues
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{3,}/g, '  ')
    .replace(/[^\x20-\x7E\n]/g, '') // Remove non-printable chars
    .trim();
}

function extractAllInfo(text) {
  // Initialize result
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
    documentType: '',
    recordingInfo: {}
  };

  // Extract document type
  info.documentType = extractDocumentType(text);

  // Extract names - Multiple strategies
  const names = extractNamesComprehensive(text);
  info.grantee = names.grantee;
  info.originalGrantor = names.grantor;
  
  // Parse grantee into grantor1 and grantor2
  if (info.grantee) {
    const parsed = parseIntoTwoNames(info.grantee);
    info.grantor1 = parsed.name1;
    info.grantor2 = parsed.name2;
  }

  // Extract property information
  const propInfo = extractPropertyComprehensive(text);
  Object.assign(info, propInfo);

  // Extract APN
  info.apn = extractAPNComprehensive(text);

  // Extract legal description
  info.legalDescription = extractLegalComprehensive(text);

  // Extract recording information
  info.recordingInfo = extractRecordingInfo(text);

  return info;
}

function extractNamesComprehensive(text) {
  const result = { grantor: '', grantee: '' };
  
  // Multiple patterns for grantee (who receives the property)
  const granteePatterns = [
    // Standard grant deed patterns
    /(?:hereby\s+)?GRANT(?:S)?\s+(?:and\s+convey\s+)?to[:;\s]+([A-Z][A-Za-z\s,\.\-\']+?)(?:\s*,\s*(?:a|an|as|whose|husband|wife))/i,
    /(?:hereby\s+)?GRANT(?:S)?\s+to[:;\s]+([^,\n]+(?:\s+(?:AND|and)\s+[^,\n]+)?)/i,
    /(?:GRANT(?:S)?|grant(?:s)?)\s+to\s+([A-Z][^,\n]+)/,
    /to\s+([A-Z][A-Z\s\.\-]+(?:\s+(?:AND|and|&)\s+[A-Z][A-Z\s\.\-]+))/,
    /Grantee(?:s)?[:;\s]+([^,\n]+)/i,
    /(?:in\s+favor\s+of|to)\s+([A-Z][A-Za-z\s,\.\-\']+?)(?:\s*,\s*(?:Trustee|TRUSTEE))/i
  ];
  
  for (const pattern of granteePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      result.grantee = cleanName(match[1]);
      if (result.grantee) {
        console.log('Found grantee:', result.grantee);
        break;
      }
    }
  }

  // If no grantee found, try WHEN RECORDED MAIL TO section
  if (!result.grantee) {
    const mailToMatch = text.match(/WHEN\s+RECORDED\s+MAIL\s+TO[:;\s]*\n?([^\n]+)/i);
    if (mailToMatch && mailToMatch[1]) {
      const possibleName = cleanName(mailToMatch[1]);
      if (possibleName && possibleName.length > 5 && !possibleName.includes('Title')) {
        result.grantee = possibleName;
        console.log('Found grantee from mail-to:', result.grantee);
      }
    }
  }

  // Patterns for grantor (who gives the property)
  const grantorPatterns = [
    /^([A-Z][A-Za-z\s,\.\-\']+?)\s+(?:hereby\s+)?GRANT/mi,
    /(?:undersigned\s+)?Grantor(?:s)?[:;\s]+([^,\n]+)/i,
    /FOR\s+(?:A\s+)?VALUABLE\s+CONSIDERATION[^,]*,\s*([A-Z][A-Za-z\s,\.\-\']+?)\s+(?:hereby|GRANT)/i,
    /^([A-Z][A-Z\s\.\-]+(?:\s+(?:AND|and)\s+[A-Z][A-Z\s\.\-]+)?)[,\s]+(?:an?\s+)?(?:unmarried|married)/mi
  ];
  
  for (const pattern of grantorPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      result.grantor = cleanName(match[1]);
      if (result.grantor) {
        console.log('Found grantor:', result.grantor);
        break;
      }
    }
  }

  return result;
}

function extractPropertyComprehensive(text) {
  const info = {
    propertyAddress: '',
    propertyCity: '',
    propertyZip: ''
  };

  // Address patterns
  const addressPatterns = [
    // Standard address format
    /(\d+\s+[A-Za-z\s\.\-\']+?(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Boulevard|Blvd|Circle|Cir|Parkway|Pkwy|Trail|Terrace|Ter)\.?)(?:[,\s]+([A-Za-z\s]+?))?(?:[,\s]+CA)?(?:\s+(\d{5}))?/i,
    // Commonly known as
    /(?:Commonly\s+known\s+as|property\s+known\s+as)[:;\s]+([^\n]+)/i,
    // Property situated in
    /(?:Property|Real\s+property)\s+(?:situated|located)\s+(?:in|at)[:;\s]+([^\n]+)/i,
    // Simple number + street pattern
    /(\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Way|Lane|Ln))/i
  ];

  for (const pattern of addressPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      info.propertyAddress = cleanAddress(match[1]);
      if (match[2]) info.propertyCity = cleanCity(match[2]);
      if (match[3]) info.propertyZip = match[3];
      if (info.propertyAddress) {
        console.log('Found property address:', info.propertyAddress);
        break;
      }
    }
  }

  // City patterns if not found
  if (!info.propertyCity) {
    const cityPatterns = [
      /(?:City\s+of\s+)([A-Za-z\s]+?)(?:[,\s]+(?:County|CA))/i,
      /([A-Za-z\s]+?)(?:[,\s]+CA\s+9\d{4})/i,
      /in\s+([A-Za-z\s]+?)\s+County/i
    ];
    
    for (const pattern of cityPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        info.propertyCity = cleanCity(match[1]);
        if (info.propertyCity) {
          console.log('Found city:', info.propertyCity);
          break;
        }
      }
    }
  }

  // ZIP pattern if not found
  if (!info.propertyZip) {
    const zipMatch = text.match(/\b(9\d{4}(?:-\d{4})?)\b/);
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
    /(?:APN|A\.P\.N\.|Assessor'?s?\s+Parcel\s+(?:Number|No\.?))[:;\s]*([\d]{3,4}[-\s][\d]{3,4}[-\s][\d]{2,4})/i,
    /(?:Parcel\s+(?:Number|No\.?))[:;\s]*([\d]{3,4}[-\s][\d]{3,4}[-\s][\d]{2,4})/i,
    /(?:APN)[:;\s]*([\d]{3,4}[\s\-\.]+[\d]{3,4}[\s\-\.]+[\d]{2,4})/i,
    // Generic pattern
    /\b([\d]{3,4}[-\s][\d]{3,4}[-\s][\d]{2,4})\b/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const apn = match[1].replace(/[\s\.]+/g, '-');
      console.log('Found APN:', apn);
      return apn;
    }
  }

  return '';
}

function extractLegalComprehensive(text) {
  const patterns = [
    // Primary pattern - after "State of CA, described as:"
    /State\s+of\s+CA,?\s+described\s+as:\s*([^]*?)(?=Commonly\s+known\s+as:|COMMONLY\s+KNOWN\s+AS:|Dated:|DATED:|$)/is,
    // Alternative - after "County of ... State of CA, described as:"
    /County\s+of\s+[^,]+,?\s+State\s+of\s+CA,?\s+described\s+as:\s*([^]*?)(?=Commonly\s+known\s+as:|COMMONLY\s+KNOWN\s+AS:|Dated:|DATED:|$)/is,
    // Another variation - "the CITY OF"
    /the\s+CITY\s+OF\s+[^,]+,?\s+County\s+of\s+[^,]+,?\s+State\s+of\s+CA,?\s+described\s+as:\s*([^]*?)(?=Commonly\s+known\s+as:|COMMONLY\s+KNOWN\s+AS:|Dated:|DATED:|$)/is,
    // PARCEL format (as fallback)
    /(PARCEL\s+\d+:[^]*?)(?=Commonly\s+known\s+as:|COMMONLY\s+KNOWN\s+AS:|Dated:|DATED:|$)/is,
    // Lot and Tract (fallback)
    /(Lot\s+\d+[^\.]*?(?:Tract|Block)\s+(?:No\.?\s*)?\d+[^\.]*?(?:\.|(?=\n\n)))/is,
    // Legal description section
    /(?:Legal\s+Description|LEGAL\s+DESCRIPTION)[:;\s]+([^\.]+(?:\.[^\.]+){0,2}\.)/is,
    // Real property described as
    /(?:Real\s+property|Property)\s+(?:described\s+as|more\s+particularly\s+described\s+as)[:;\s]+([^\.]+(?:\.[^\.]+){0,2}\.)/is,
    // That certain real property
    /(That\s+certain\s+(?:real\s+)?property[^\.]+(?:\.[^\.]+){0,2}\.)/is
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      let desc = match[1].replace(/\s+/g, ' ').replace(/\n/g, ' ').trim();
      // Keep up to 2000 characters for complex legal descriptions
      desc = desc.substring(0, 2000);
      if (desc && desc.length > 10) { // Make sure we got something substantial
        console.log('Found legal description:', desc.substring(0, 100) + '...');
        return desc;
      }
    }
  }

  return '';
}

function extractRecordingInfo(text) {
  const info = {};

  // Recording date
  const datePatterns = [
    /(?:Recorded|Recording\s+Date)[:;\s]+(\w+\s+\d{1,2},?\s+\d{4})/i,
    /(?:Date\s+)?Recorded[:;\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      info.recordingDate = match[1];
      break;
    }
  }

  // Document number
  const docPatterns = [
    /(?:Document|Instrument|Recording)\s+(?:Number|No\.?)[:;\s]+([\d\-]+)/i,
    /Doc\s+#[:;\s]*([\d\-]+)/i
  ];

  for (const pattern of docPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      info.documentNumber = match[1];
      break;
    }
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
    'INTERSPOUSAL TRANSFER DEED',
    'TRANSFER DEED'
  ];

  const upperText = text.toUpperCase();
  for (const type of types) {
    if (upperText.includes(type)) {
      return type;
    }
  }

  return 'DEED';
}

function parseIntoTwoNames(fullName) {
  if (!fullName) return { name1: '', name2: '' };

  fullName = fullName.trim();

  // Look for separators
  const separators = [
    /\s+AND\s+/i,
    /\s+&\s+/,
    /\s*,\s+(?!Trustee|TRUSTEE)/
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

  // Check for "FIRST LAST and FIRST LAST" format
  const andMatch = fullName.match(/^([A-Z][a-z]+\s+[A-Z][a-z]+)\s+and\s+([A-Z][a-z]+\s+[A-Z][a-z]+)$/i);
  if (andMatch) {
    return {
      name1: andMatch[1],
      name2: andMatch[2]
    };
  }

  // Single name
  return {
    name1: fullName,
    name2: ''
  };
}

function cleanName(name) {
  if (!name) return '';
  
  // Remove common suffixes and clean up
  return name
    .replace(/\s+/g, ' ')
    .replace(/,?\s*$/, '')
    .replace(/\b(?:husband|wife|married|single|unmarried|trustee|successor|trust|individually|Jr\.|Sr\.|III|II)\b.*/gi, '')
    .replace(/\b(?:a|an)\s+(?:unmarried|married|single)\s+(?:man|woman|person)\b.*/gi, '')
    .trim()
    .replace(/,\s*$/, '');
}

function cleanAddress(address) {
  if (!address) return '';
  return address
    .replace(/\s+/g, ' ')
    .replace(/,?\s*$/, '')
    .replace(/\bCA\b.*$/i, '') // Remove CA and anything after
    .trim();
}

function cleanCity(city) {
  if (!city) return '';
  return city
    .replace(/\s+/g, ' ')
    .replace(/,.*$/, '')
    .replace(/\s*County.*$/i, '')
    .replace(/\s*CA\s*$/i, '')
    .trim();
}

function cleanLegalDescription(desc) {
  if (!desc) return '';
  return desc
    .replace(/\s+/g, ' ')
    .replace(/\n/g, ' ')
    .substring(0, 2000)  // Changed from 500 to 2000
    .trim();
}
