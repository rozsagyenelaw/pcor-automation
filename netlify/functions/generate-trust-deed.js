const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = require('docx');

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
    const requestData = JSON.parse(event.body);
    const { data, format = 'pdf' } = requestData; // Default to PDF if no format specified
    
    console.log('Received data for trust deed:', data);
    console.log('Requested format:', format);
    
    // Format data
    const today = new Date();
    const dateStr = formatDate(today);
    const trustDate = data.trustDate ? formatDate(new Date(data.trustDate)) : dateStr;
    const trustName = data.trustName || buildTrustName(data.grantor1Name, data.grantor2Name);
    const grantorNames = buildGrantorNames(data);
    const trusteeNames = buildTrusteeNames(data, trustName, trustDate);
    const mailingInfo = buildMailingInfo(data);
    
    let result;
    
    switch(format.toLowerCase()) {
      case 'txt':
      case 'text':
        result = await generateTextFormat(data, {
          dateStr, trustDate, trustName, grantorNames, trusteeNames, mailingInfo
        });
        break;
      
      case 'docx':
      case 'word':
        result = await generateWordFormat(data, {
          dateStr, trustDate, trustName, grantorNames, trusteeNames, mailingInfo
        });
        break;
      
      case 'pdf':
      default:
        result = await generatePDFFormat(data, {
          dateStr, trustDate, trustName, grantorNames, trusteeNames, mailingInfo
        });
        break;
    }
    
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        ...result,
        message: `Trust deed generated successfully as ${format.toUpperCase()}`
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

// Generate Text Format
async function generateTextFormat(data, formattedData) {
  const { dateStr, trustDate, trustName, grantorNames, trusteeNames, mailingInfo } = formattedData;
  
  const textContent = `RECORDING REQUESTED BY
${trustName}

WHEN RECORDED MAIL TO
${mailingInfo.name}
${mailingInfo.address}
${mailingInfo.cityStateZip}

================================================================================
APN: ${data.apn || '_________________'}                    Escrow No. ______________

                              TRUST TRANSFER DEED
            (Grant Deed Excluded from Reappraisal Under Proposition 13,
                    i.e., Calif. Const. Art 13A Section 1, et seq.)

DOCUMENTARY TRANSFER TAX IS: $ 0.00

The undersigned Grantor(s) declare(s) under penalty of perjury that the foregoing is true
and correct: THERE IS NO CONSIDERATION FOR THIS TRANSFER.

This is a Trust Transfer under section 62 of the Revenue and Taxation Code and
Grantor(s) has/have checked the applicable exclusions:

[X] This conveyance transfers the Grantors interest into his or her revocable trust,
    R&T 11930.

GRANTOR(S) ${grantorNames}, hereby GRANT(s) to

${trusteeNames}, AND ANY AMENDMENTS THERETO

the real property in the CITY OF ${data.propertyCity || '_________________'} 
County of Los Angeles State of CA, described as:

${data.legalDescription || '[INSERT LEGAL DESCRIPTION HERE]'}

Commonly known as: ${data.propertyAddress || '_________________'}

Dated: ${dateStr}


_________________________________     _________________________________
${data.grantor1Name || ''}                     ${data.grantor2Name || ''}


MAIL TAX STATEMENTS TO:
${mailingInfo.name}
${mailingInfo.address}
${mailingInfo.cityStateZip}

================================================================================
                                  NOTARY ACKNOWLEDGMENT
                                      (Page 2)

STATE OF CALIFORNIA       )
                         ) SS.
COUNTY OF ______________ )

On ________________, before me, ___________________________________, a Notary Public,
personally appeared ____________________________________________, who proved to me on
the basis of satisfactory evidence to be the person whose name is subscribed to the
within instrument acknowledged to me that he/she/they executed the same in his/her/their
authorized capacity, and that by his/her/their signature on the instrument the person,
or the entity upon behalf of which the person acted, executed the instrument.

I certify under PENALTY OF PERJURY under the laws of the State of California that the
foregoing paragraph is true and correct.

WITNESS my hand and official seal.


Notary Public __________________________________ (SEAL)

Print Name of Notary _______________________________

My Commission Expires: ______________.

--------------------------------------------------------------------------------
A notary public or other officer completing this certificate verifies only the
identity of the individual who signed the document to which this certificate is
attached, and not the truthfulness, accuracy, or validity of that document.
--------------------------------------------------------------------------------`;

  // Convert to base64
  const base64 = Buffer.from(textContent).toString('base64');
  
  return {
    textUrl: `data:text/plain;base64,${base64}`,
    format: 'txt'
  };
}

// Generate Word Format
async function generateWordFormat(data, formattedData) {
  const { dateStr, trustDate, trustName, grantorNames, trusteeNames, mailingInfo } = formattedData;
  
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        // Header Box
        new Paragraph({
          children: [new TextRun({ text: "RECORDING REQUESTED BY", bold: true })],
          alignment: AlignmentType.LEFT,
        }),
        new Paragraph({
          children: [new TextRun(trustName)],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [new TextRun({ text: "WHEN RECORDED MAIL TO", bold: true })],
        }),
        new Paragraph({
          children: [new TextRun(mailingInfo.name)],
        }),
        new Paragraph({
          children: [new TextRun(mailingInfo.address)],
        }),
        new Paragraph({
          children: [new TextRun(mailingInfo.cityStateZip)],
          spacing: { after: 400 },
          border: {
            bottom: {
              color: "000000",
              space: 1,
              style: BorderStyle.SINGLE,
              size: 6,
            },
          },
        }),
        
        // APN Section
        new Paragraph({
          children: [
            new TextRun(`APN: ${data.apn || '_________________'}`),
            new TextRun({ text: "                    Escrow No. ______________", break: 0 }),
          ],
          spacing: { after: 300 },
        }),
        
        // Title
        new Paragraph({
          children: [new TextRun({ text: "TRUST TRANSFER DEED", bold: true, size: 28 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
        }),
        new Paragraph({
          children: [new TextRun({ text: "(Grant Deed Excluded from Reappraisal Under Proposition 13,", size: 18 })],
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          children: [new TextRun({ text: "i.e., Calif. Const. Art 13A Section 1, et seq.)", size: 18 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
        }),
        
        // Documentary Transfer Tax
        new Paragraph({
          children: [new TextRun({ text: "DOCUMENTARY TRANSFER TAX IS: $ 0.00", bold: true })],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [new TextRun("The undersigned Grantor(s) declare(s) under penalty of perjury that the foregoing is true")],
        }),
        new Paragraph({
          children: [new TextRun("and correct: THERE IS NO CONSIDERATION FOR THIS TRANSFER.")],
          spacing: { after: 200 },
        }),
        
        // Trust Transfer Section
        new Paragraph({
          children: [new TextRun("This is a Trust Transfer under section 62 of the Revenue and Taxation Code and")],
        }),
        new Paragraph({
          children: [new TextRun("Grantor(s) has/have checked the applicable exclusions:")],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [new TextRun("[X] This conveyance transfers the Grantors interest into his or her revocable trust, R&T 11930.")],
          indent: { left: 360 },
          spacing: { after: 300 },
        }),
        
        // Grant Section
        new Paragraph({
          children: [new TextRun(`GRANTOR(S) ${grantorNames}, hereby GRANT(s) to`)],
          spacing: { after: 100 },
        }),
        new Paragraph({
          children: [new TextRun(`${trusteeNames}, AND ANY AMENDMENTS THERETO`)],
          spacing: { after: 100 },
        }),
        new Paragraph({
          children: [new TextRun(`the real property in the CITY OF ${data.propertyCity || '_________________'}`)],
        }),
        new Paragraph({
          children: [new TextRun("County of Los Angeles State of CA, described as:")],
          spacing: { after: 200 },
        }),
        
        // Legal Description
        new Paragraph({
          children: [new TextRun(data.legalDescription || '[INSERT LEGAL DESCRIPTION HERE]')],
          spacing: { after: 300 },
        }),
        
        // Commonly Known As
        new Paragraph({
          children: [new TextRun(`Commonly known as: ${data.propertyAddress || '_________________'}`)],
          spacing: { after: 400 },
        }),
        
        // Date and Signatures
        new Paragraph({
          children: [new TextRun(`Dated: ${dateStr}`)],
          spacing: { after: 400 },
        }),
        new Paragraph({
          children: [
            new TextRun("_________________________________     _________________________________"),
          ],
          spacing: { after: 100 },
        }),
        new Paragraph({
          children: [
            new TextRun(`${data.grantor1Name || ''}                                        ${data.grantor2Name || ''}`),
          ],
          spacing: { after: 400 },
        }),
        
        // Mail Tax Statements
        new Paragraph({
          children: [new TextRun({ text: "MAIL TAX STATEMENTS TO:", bold: true })],
        }),
        new Paragraph({
          children: [new TextRun(mailingInfo.name)],
        }),
        new Paragraph({
          children: [new TextRun(mailingInfo.address)],
        }),
        new Paragraph({
          children: [new TextRun(mailingInfo.cityStateZip)],
          pageBreakBefore: false,
        }),
        
        // Page Break for Notary
        new Paragraph({
          children: [new TextRun("")],
          pageBreakBefore: true,
        }),
        
        // Notary Section
        new Paragraph({
          children: [new TextRun({ text: "NOTARY ACKNOWLEDGMENT", bold: true, size: 28 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        }),
        new Paragraph({
          children: [new TextRun("STATE OF CALIFORNIA     )")],
        }),
        new Paragraph({
          children: [new TextRun("                                              ) SS.")],
        }),
        new Paragraph({
          children: [new TextRun("COUNTY OF _____________ )")],
          spacing: { after: 300 },
        }),
        new Paragraph({
          children: [new TextRun("On ________________, before me, ___________________________________, a Notary Public,")],
        }),
        new Paragraph({
          children: [new TextRun("personally appeared ____________________________________________, who proved to me on")],
        }),
        new Paragraph({
          children: [new TextRun("the basis of satisfactory evidence to be the person whose name is subscribed to the within")],
        }),
        new Paragraph({
          children: [new TextRun("instrument acknowledged to me that he/she/they executed the same in his/her/their")],
        }),
        new Paragraph({
          children: [new TextRun("authorized capacity, and that by his/her/their signature on the instrument the person, or")],
        }),
        new Paragraph({
          children: [new TextRun("the entity upon behalf of which the person acted, executed the instrument.")],
          spacing: { after: 300 },
        }),
        new Paragraph({
          children: [new TextRun("I certify under PENALTY OF PERJURY under the laws of the State of California that the")],
        }),
        new Paragraph({
          children: [new TextRun("foregoing paragraph is true and correct.")],
          spacing: { after: 300 },
        }),
        new Paragraph({
          children: [new TextRun("WITNESS my hand and official seal.")],
          spacing: { after: 400 },
        }),
        new Paragraph({
          children: [new TextRun("Notary Public __________________________________ (SEAL)")],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [new TextRun("Print Name of Notary _______________________________")],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [new TextRun("My Commission Expires: ______________.")],
          spacing: { after: 400 },
        }),
        
        // Notice Box
        new Paragraph({
          children: [new TextRun("A notary public or other officer completing this certificate verifies only the identity of the")],
          border: {
            top: { color: "000000", space: 1, style: BorderStyle.SINGLE, size: 6 },
            bottom: { color: "000000", space: 1, style: BorderStyle.SINGLE, size: 6 },
            left: { color: "000000", space: 1, style: BorderStyle.SINGLE, size: 6 },
            right: { color: "000000", space: 1, style: BorderStyle.SINGLE, size: 6 },
          },
          spacing: { before: 200, after: 0 },
          indent: { left: 360, right: 360 },
        }),
        new Paragraph({
          children: [new TextRun("individual who signed the document to which this certificate is attached, and not the")],
          indent: { left: 360, right: 360 },
        }),
        new Paragraph({
          children: [new TextRun("truthfulness, accuracy, or validity of that document.")],
          border: {
            bottom: { color: "000000", space: 1, style: BorderStyle.SINGLE, size: 6 },
            left: { color: "000000", space: 1, style: BorderStyle.SINGLE, size: 6 },
            right: { color: "000000", space: 1, style: BorderStyle.SINGLE, size: 6 },
          },
          indent: { left: 360, right: 360 },
        }),
      ],
    }],
  });
  
  const buffer = await Packer.toBuffer(doc);
  const base64 = buffer.toString('base64');
  
  return {
    docxUrl: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${base64}`,
    format: 'docx'
  };
}

// Generate PDF Format (original function)
async function generatePDFFormat(data, formattedData) {
  const { dateStr, trustDate, trustName, grantorNames, trusteeNames, mailingInfo } = formattedData;
  
  // Create a new blank PDF
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const { width, height } = page.getSize();
  
  // Embed fonts
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  // Dynamic Y position tracking
  let currentY = height - 80;
  const lineHeight = 13;
  const sectionGap = 20;
  
  // Header box
  page.drawRectangle({
    x: 100,
    y: height - 200,
    width: 400,
    height: 150,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1
  });
  
  // Header content
  page.drawText('RECORDING REQUESTED BY', {
    x: 110,
    y: currentY,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 20;
  page.drawText(trustName, {
    x: 110,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 30;
  page.drawText('WHEN RECORDED MAIL TO', {
    x: 110,
    y: currentY,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 20;
  page.drawText(mailingInfo.name, {
    x: 110,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 15;
  page.drawText(mailingInfo.address, {
    x: 110,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 15;
  page.drawText(mailingInfo.cityStateZip, {
    x: 110,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  // Move below the box
  currentY = height - 230;
  
  // APN section
  page.drawText(`APN: ${data.apn || ''}`, {
    x: 100,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  page.drawText('Escrow No.', {
    x: 350,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 40;
  
  // Title
  page.drawText('TRUST TRANSFER DEED', {
    x: 200,
    y: currentY,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 15;
  page.drawText('(Grant Deed Excluded from Reappraisal Under Proposition 13, i.e., Calif. Const. Art', {
    x: 120,
    y: currentY,
    size: 9,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 13;
  page.drawText('13A Section 1, et seq.)', {
    x: 120,
    y: currentY,
    size: 9,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 22;
  
  // Documentary transfer tax
  page.drawText('DOCUMENTARY TRANSFER TAX IS: $ 0', {
    x: 100,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 20;
  page.drawText('The undersigned Grantor(s) declare(s) under penalty of perjury that the foregoing is true', {
    x: 100,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 13;
  page.drawText('and correct: THERE IS NO CONSIDERATION FOR THIS TRANSFER.', {
    x: 100,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 20;
  
  // Trust transfer section
  page.drawText('This is a Trust Transfer under section 62 of the Revenue and Taxation Code and', {
    x: 100,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 13;
  page.drawText('Grantor(s) has/have checked the applicable exclusions:', {
    x: 100,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 20;
  page.drawText('[X] This conveyance transfers the Grantors interest into his or her revocable trust, R&T', {
    x: 100,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 13;
  page.drawText('11930.', {
    x: 115,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 26;
  
  // Grant section
  page.drawText(`GRANTOR(S) ${grantorNames}`, {
    x: 100,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 13;
  page.drawText(`, hereby GRANT(s) to`, {
    x: 100,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 13;
  // Handle long trustee names
  const trusteeLines = wrapText(trusteeNames, font, 10, 400);
  for (const line of trusteeLines) {
    page.drawText(line, {
      x: 100,
      y: currentY,
      size: 10,
      font: font,
      color: rgb(0, 0, 0)
    });
    currentY -= 13;
  }
  
  page.drawText(', AND ANY AMENDMENTS THERETO the real property in', {
    x: 100,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 13;
  page.drawText(`the CITY OF ${data.propertyCity || ''} County of Los Angeles State of CA, described as:`, {
    x: 100,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 23;
  
  // Legal description - DYNAMIC POSITIONING
  if (data.legalDescription) {
    const legalLines = wrapText(data.legalDescription, font, 10, 400);
    for (const line of legalLines) {
      page.drawText(line, {
        x: 100,
        y: currentY,
        size: 10,
        font: font,
        color: rgb(0, 0, 0)
      });
      currentY -= 13;
    }
  }
  
  // Add extra spacing after legal description
  currentY -= 20;
  
  // Commonly known as
  page.drawText(`Commonly known as: ${data.propertyAddress || ''}`, {
    x: 100,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 30;
  
  // Date
  page.drawText(`Dated: ${dateStr}`, {
    x: 100,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  currentY -= 40;
  
  // Signature lines
  page.drawLine({
    start: { x: 100, y: currentY },
    end: { x: 250, y: currentY },
    color: rgb(0, 0, 0),
    thickness: 1
  });
  
  page.drawLine({
    start: { x: 350, y: currentY },
    end: { x: 500, y: currentY },
    color: rgb(0, 0, 0),
    thickness: 1
  });
  
  currentY -= 15;
  page.drawText(data.grantor1Name || '', {
    x: 100,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  page.drawText(data.grantor2Name || '', {
    x: 350,
    y: currentY,
    size: 10,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  // Only add mail tax statements section if there's enough space
  if (currentY > 100) {
    currentY -= 35;
    
    page.drawText('MAIL TAX STATEMENTS TO:', {
      x: 100,
      y: currentY,
      size: 10,
      font: boldFont,
      color: rgb(0, 0, 0)
    });
    
    currentY -= 20;
    page.drawText(mailingInfo.name, {
      x: 100,
      y: currentY,
      size: 10,
      font: font,
      color: rgb(0, 0, 0)
    });
    
    currentY -= 15;
    page.drawText(mailingInfo.address, {
      x: 100,
      y: currentY,
      size: 10,
      font: font,
      color: rgb(0, 0, 0)
    });
    
    currentY -= 15;
    page.drawText(mailingInfo.cityStateZip, {
      x: 100,
      y: currentY,
      size: 10,
      font: font,
      color: rgb(0, 0, 0)
    });
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
    pdfUrl: `data:application/pdf;base64,${base64}`,
    format: 'pdf'
  };
}

// Helper functions
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
  if (!text) return [];
  
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
