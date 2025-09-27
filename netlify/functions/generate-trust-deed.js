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
    
    // Create a new blank PDF instead of loading template
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]); // Letter size
    const { width, height } = page.getSize();
    
    // Embed fonts
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Format data
    const today = new Date();
    const dateStr = formatDate(today);
    const trustDate = data.trustDate ? formatDate(new Date(data.trustDate)) : dateStr;
    const trustName = data.trustName || buildTrustName(data.grantor1Name, data.grantor2Name);
    const grantorNames = buildGrantorNames(data);
    const trusteeNames = buildTrusteeNames(data, trustName, trustDate);
    const mailingInfo = buildMailingInfo(data);
    
    // Draw the complete trust deed document
    const content = [
      // Header box
      { type: 'box', x: 100, y: height - 200, width: 400, height: 150 },
      { text: 'RECORDING REQUESTED BY', x: 110, y: height - 80, font: boldFont, size: 10 },
      { text: trustName, x: 110, y: height - 100, font: font, size: 10 },
      { text: 'WHEN RECORDED MAIL TO', x: 110, y: height - 130, font: boldFont, size: 10 },
      { text: mailingInfo.name, x: 110, y: height - 150, font: font, size: 10 },
      { text: mailingInfo.address, x: 110, y: height - 165, font: font, size: 10 },
      { text: mailingInfo.cityStateZip, x: 110, y: height - 180, font: font, size: 10 },
      
      // APN section
      { text: `APN: ${data.apn}`, x: 100, y: height - 230, font: font, size: 10 },
      { text: 'Escrow No.', x: 350, y: height - 230, font: font, size: 10 },
      
      // Title
      { text: 'TRUST TRANSFER DEED', x: 200, y: height - 270, font: boldFont, size: 14 },
      { text: '(Grant Deed Excluded from Reappraisal Under Proposition 13, i.e., Calif. Const. Art', x: 120, y: height - 285, font: font, size: 9 },
      { text: '13A Section t, et seq.)', x: 120, y: height - 298, font: font, size: 9 },
      
      // Documentary transfer tax
      { text: 'DOCUMENTARY TRANSFER TAX IS: $ 0', x: 100, y: height - 320, font: font, size: 10 },
      { text: 'The undersigned Grantor(s) declare(s) under penalty of perjury that the foregoing is true', x: 100, y: height - 340, font: font, size: 10 },
      { text: 'and correct: THERE IS NO CONSIDERATION FOR THIS TRANSFER.', x: 100, y: height - 353, font: font, size: 10 },
      
      // Trust transfer section
      { text: 'This is a Trust Transfer under section 62 of the Revenue and Taxation Code and', x: 100, y: height - 373, font: font, size: 10 },
      { text: 'Grantor(s) has/have checked the applicable exclusions:', x: 100, y: height - 386, font: font, size: 10 },
      { text: '[X] This conveyance transfers the Grantors interest into his or her revocable trust, R&T', x: 100, y: height - 406, font: font, size: 10 },
      { text: '11930.', x: 115, y: height - 419, font: font, size: 10 },
      
      // Grant section
      { text: `GRANTOR(S) ${grantorNames}`, x: 100, y: height - 445, font: font, size: 10 },
      { text: `, hereby GRANT(s) to`, x: 100, y: height - 458, font: font, size: 10 },
      { text: trusteeNames, x: 100, y: height - 471, font: font, size: 10 },
      { text: ', AND ANY AMENDMENTS THERETO the real property in', x: 100, y: height - 484, font: font, size: 10 },
      { text: `the CITY OF ${data.propertyCity} County of Los Angeles State of CA, described as:`, x: 100, y: height - 497, font: font, size: 10 },
      
      // Legal description
      { text: data.legalDescription || '', x: 100, y: height - 520, font: font, size: 10, maxWidth: 400 },
      
      // Commonly known as
      { text: `Commonly known as: ${data.propertyAddress}`, x: 100, y: height - 560, font: font, size: 10 },
      
      // Date
      { text: `Dated: ${dateStr}`, x: 100, y: height - 590, font: font, size: 10 },
      
      // Signature lines
      { type: 'line', x: 100, y: height - 630, endX: 250, endY: height - 630 },
      { type: 'line', x: 350, y: height - 630, endX: 500, endY: height - 630 },
      { text: data.grantor1Name || '', x: 100, y: height - 645, font: font, size: 10 },
      { text: data.grantor2Name || '', x: 350, y: height - 645, font: font, size: 10 },
      
      // Mail tax statements section
      { text: 'MAIL TAX STATEMENTS TO:', x: 100, y: height - 680, font: boldFont, size: 10 },
      { text: mailingInfo.name, x: 100, y: height - 700, font: font, size: 10 },
      { text: mailingInfo.address, x: 100, y: height - 715, font: font, size: 10 },
      { text: mailingInfo.cityStateZip, x: 100, y: height - 730, font: font, size: 10 }
    ];
    
    // Draw all content
    for (const item of content) {
      if (item.type === 'box') {
        page.drawRectangle({
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          borderColor: rgb(0, 0, 0),
          borderWidth: 1
        });
      } else if (item.type === 'line') {
        page.drawLine({
          start: { x: item.x, y: item.y },
          end: { x: item.endX, y: item.endY },
          color: rgb(0, 0, 0),
          thickness: 1
        });
      } else if (item.text) {
        if (item.maxWidth) {
          const lines = wrapText(item.text, item.font, item.size, item.maxWidth);
          let yPos = item.y;
          for (const line of lines) {
            page.drawText(line, {
              x: item.x,
              y: yPos,
              size: item.size,
              font: item.font,
              color: rgb(0, 0, 0)
            });
            yPos -= item.size + 2;
          }
        } else {
          page.drawText(item.text, {
            x: item.x,
            y: item.y,
            size: item.size,
            font: item.font,
            color: rgb(0, 0, 0)
          });
        }
      }
    }
    
    // Add second page for notary
    const page2 = pdfDoc.addPage([612, 792]);
    const notaryContent = [
      { text: 'STATE OF CALIFORNIA )', x: 100, y: 700, font: font, size: 11 },
      { text: ')', x: 280, y: 685, font: font, size: 11 },
      { text: 'COUNTY OF ______________)', x: 100, y: 670, font: font, size: 11 },
      
      { text: 'On ________________, before me, ___________________, a Notary Public, personally', x: 100, y: 630, font: font, size: 11 },
      { text: 'appeared ________________________________, who proved to me on the basis', x: 100, y: 615, font: font, size: 11 },
      { text: 'of satisfactory evidence to be the person whose name is subscribed to the within', x: 100, y: 600, font: font, size: 11 },
      { text: 'instrument acknowledged to me that he/she/they executed the same in his/her/their', x: 100, y: 585, font: font, size: 11 },
      { text: 'authorized capacity, and that by his/her/their signature on the instrument the person, or', x: 100, y: 570, font: font, size: 11 },
      { text: 'the entity upon behalf of which the person acted, executed the instrument.', x: 100, y: 555, font: font, size: 11 },
      
      { text: 'I certify under PENALTY OF PERJURY under the laws of the State of California that the', x: 100, y: 520, font: font, size: 11 },
      { text: 'foregoing paragraph is true and correct.', x: 100, y: 505, font: font, size: 11 },
      
      { text: 'WITNESS my hand and official seal.', x: 100, y: 470, font: font, size: 11 },
      
      { text: 'Notary Public __________________________________ (SEAL)', x: 100, y: 420, font: font, size: 11 },
      { text: 'Print Name of Notary _______________________________', x: 100, y: 390, font: font, size: 11 },
      { text: 'My Commission Expires: ______________.', x: 100, y: 360, font: font, size: 11 },
      
      // Notary notice box
      { type: 'box', x: 100, y: 200, width: 400, height: 80 },
      { text: 'A notary public or other officer completing this certificate verifies only the identity of the', x: 110, y: 260, font: font, size: 10 },
      { text: 'individual who signed the document to which this certificate is attached, and not the', x: 110, y: 245, font: font, size: 10 },
      { text: 'truthfulness, accuracy, or validity of that document.', x: 110, y: 230, font: font, size: 10 }
    ];
    
    for (const item of notaryContent) {
      if (item.type === 'box') {
        page2.drawRectangle({
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          borderColor: rgb(0, 0, 0),
          borderWidth: 2
        });
      } else if (item.text) {
        page2.drawText(item.text, {
          x: item.x,
          y: item.y,
          size: item.size,
          font: item.font,
          color: rgb(0, 0, 0)
        });
      }
    }
    
    const pdfBytes = await pdfDoc.save();
    const base64 = Buffer.from(pdfBytes).toString('base64');
    
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        pdfUrl: `data:application/pdf;base64,${base64}`,
        message: 'Trust deed generated successfully'
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

function wrapText(text, font, fontSize, maxWidth) {
  // Remove newlines and extra spaces
  text = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  
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
