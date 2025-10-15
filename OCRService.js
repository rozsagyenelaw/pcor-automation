import * as pdfjsLib from 'pdfjs-dist/webpack';
import Tesseract from 'tesseract.js';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

class OCRService {
  /**
   * Main function to extract text from a PDF file
   * @param {File} pdfFile - The PDF file to process
   * @param {Function} onProgress - Callback for progress updates
   * @returns {Promise<Object>} Extracted information
   */
  async extractFromPDF(pdfFile, onProgress = null) {
    try {
      console.log('Starting PDF OCR extraction...');
      
      // Convert PDF to array buffer
      const arrayBuffer = await pdfFile.arrayBuffer();
      
      // Load PDF document
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      console.log(`PDF loaded: ${pdf.numPages} pages`);
      
      // Extract text from all pages
      let fullText = '';
      
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        if (onProgress) {
          onProgress({
            status: 'processing',
            page: pageNum,
            totalPages: pdf.numPages,
            message: `Processing page ${pageNum} of ${pdf.numPages}...`
          });
        }
        
        console.log(`Processing page ${pageNum}...`);
        
        // Get the page
        const page = await pdf.getPage(pageNum);
        
        // Render page to canvas
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        // Use higher scale for better OCR accuracy
        const scale = 2.0;
        const viewport = page.getViewport({ scale });
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        // Render PDF page to canvas
        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;
        
        console.log(`Page ${pageNum} rendered to canvas`);
        
        // Convert canvas to image data
        const imageData = canvas.toDataURL('image/png');
        
        // Run OCR on the image
        console.log(`Running OCR on page ${pageNum}...`);
        const result = await Tesseract.recognize(
          imageData,
          'eng',
          {
            logger: (m) => {
              if (m.status === 'recognizing text') {
                console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
              }
            }
          }
        );
        
        fullText += result.data.text + '\n\n';
        console.log(`Page ${pageNum} OCR complete. Text length: ${result.data.text.length}`);
      }
      
      console.log('=== FULL EXTRACTED TEXT ===');
      console.log(fullText);
      console.log('===========================');
      
      if (onProgress) {
        onProgress({
          status: 'extracting',
          message: 'Analyzing document data...'
        });
      }
      
      // Extract structured information from the text
      const extractedInfo = this.extractInformation(fullText);
      
      console.log('=== EXTRACTED INFORMATION ===');
      console.log(JSON.stringify(extractedInfo, null, 2));
      console.log('============================');
      
      if (onProgress) {
        onProgress({
          status: 'complete',
          message: 'Extraction complete!'
        });
      }
      
      return {
        success: true,
        extractedInfo: extractedInfo,
        rawText: fullText
      };
      
    } catch (error) {
      console.error('OCR Error:', error);
      if (onProgress) {
        onProgress({
          status: 'error',
          message: error.message
        });
      }
      throw error;
    }
  }

  /**
   * Extract structured information from OCR text
   */
  extractInformation(text) {
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
      documentType: 'GRANT DEED',
      recordingInfo: {}
    };

    // Clean the text
    const cleanedText = this.cleanText(text);
    
    // Extract grantee (the person receiving property - this is who you need!)
    info.grantee = this.extractGrantee(cleanedText);
    
    // Parse grantee into grantor1 and grantor2 for your trust deed
    if (info.grantee) {
      const parsed = this.parseNames(info.grantee);
      info.grantor1 = parsed.name1;
      info.grantor2 = parsed.name2;
    }
    
    // Extract property address
    const addressInfo = this.extractAddress(cleanedText);
    info.propertyAddress = addressInfo.address;
    info.propertyCity = addressInfo.city;
    info.propertyZip = addressInfo.zip;
    
    // Extract APN
    info.apn = this.extractAPN(cleanedText);
    
    // Extract legal description
    info.legalDescription = this.extractLegalDescription(cleanedText);
    
    // Extract recording info
    info.recordingInfo = this.extractRecordingInfo(cleanedText);
    
    return info;
  }

  cleanText(text) {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  extractGrantee(text) {
    console.log('=== EXTRACTING GRANTEE ===');
    
    // Patterns to find the grantee (person receiving the property)
    const patterns = [
      // "hereby GRANTS TO" pattern
      /hereby\s+GRANTS?\s+(?:\([A-Z]\))?\s+TO\s+([A-Z][^\n,]+?)(?:\s*,\s*(?:Husband|Wife|as|whose))/i,
      
      // "Norik Hairapetian and Claudia Hairapetian" style
      /GRANTS?\s+(?:\([A-Z]\))?\s+TO\s+([A-Z][a-z]+\s+[A-Z][a-z]+\s+and\s+[A-Z][a-z]+\s+[A-Z][a-z]+)/i,
      
      // General TO pattern
      /\bTO\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+(?:\s+and\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)?)/,
      
      // "WHEN RECORDED MAIL TO" section
      /WHEN\s+RECORDED\s+MAIL\s+TO\s+([A-Z][^\n]+?)(?:\n|\d{4})/i,
      
      // After "Mr. & Mrs." or similar
      /(?:Mr\.\s*&\s*Mrs\.|Mr\.\s+and\s+Mrs\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i
    ];
    
    for (let i = 0; i < patterns.length; i++) {
      const match = text.match(patterns[i]);
      if (match && match[1]) {
        const name = this.cleanName(match[1]);
        if (name && name.length > 5) {
          console.log(`Found grantee with pattern ${i}: ${name}`);
          return name;
        }
      }
    }
    
    console.log('No grantee found');
    return '';
  }

  extractAddress(text) {
    console.log('=== EXTRACTING ADDRESS ===');
    
    const result = {
      address: '',
      city: '',
      zip: ''
    };
    
    // Patterns for address
    const addressPatterns = [
      // "1750 West Mountain Street" style
      /(\d{3,5}\s+(?:West|East|North|South|W|E|N|S)?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Boulevard|Blvd))/i,
      
      // Simple number + street
      /(\d{3,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+[A-Z][a-z]+)/,
      
      // After MAIL TO
      /MAIL\s+TO\s+[^\n]+\n([^\n]+\d{3,5}[^\n]+)/i
    ];
    
    for (let i = 0; i < addressPatterns.length; i++) {
      const match = text.match(addressPatterns[i]);
      if (match && match[1]) {
        result.address = match[1].trim();
        console.log(`Found address with pattern ${i}: ${result.address}`);
        break;
      }
    }
    
    // Extract city
    const cityPatterns = [
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*California/i,
      /City\s+of\s+([A-Z][a-z]+)/i,
      /,\s*([A-Z][a-z]+)\s+9\d{4}/
    ];
    
    for (const pattern of cityPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        result.city = match[1].trim();
        console.log(`Found city: ${result.city}`);
        break;
      }
    }
    
    // Extract ZIP
    const zipMatch = text.match(/\b(9\d{4})\b/);
    if (zipMatch) {
      result.zip = zipMatch[1];
      console.log(`Found ZIP: ${result.zip}`);
    }
    
    return result;
  }

  extractAPN(text) {
    console.log('=== EXTRACTING APN ===');
    
    const patterns = [
      // "Assessor's Parcel No. 5622-9-1" style
      /Assessor'?s?\s+Parcel\s+No\.\s*([\d\-]+)/i,
      /APN[:\s]+([\d\-]+)/i,
      /Parcel\s+No\.\s*([\d\-]+)/i,
      // Just the pattern 5622-9-1
      /\b(\d{4}-\d{1,2}-\d{1,2})\b/,
      /\b(\d{3,4}[-\s]\d{3,4}[-\s]\d{2,4})\b/
    ];
    
    for (let i = 0; i < patterns.length; i++) {
      const match = text.match(patterns[i]);
      if (match && match[1]) {
        const apn = match[1].replace(/\s+/g, '-');
        console.log(`Found APN with pattern ${i}: ${apn}`);
        return apn;
      }
    }
    
    console.log('No APN found');
    return '';
  }

  extractLegalDescription(text) {
    console.log('=== EXTRACTING LEGAL DESCRIPTION ===');
    
    const patterns = [
      // "THE NORTHEAST 97 FEET..." style
      /(THE\s+[A-Z]+\s+\d+\s+FEET[^\.]+(?:TRACT|LOT|MAP)[^\.]+\.)/i,
      
      // "Lot X of Tract" pattern
      /(Lot\s+\d+[^\.]*Tract\s+(?:No\.\s*)?\d+[^\.]*\.)/i,
      
      // General legal description
      /((?:LOT|PARCEL|THE)\s+[^\.]{50,500}(?:MAP|BOOK|TRACT|COUNTY)[^\.]{10,200}\.)/i
    ];
    
    for (let i = 0; i < patterns.length; i++) {
      const match = text.match(patterns[i]);
      if (match && match[1]) {
        const desc = match[1]
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 800);
        console.log(`Found legal description with pattern ${i}: ${desc.substring(0, 100)}...`);
        return desc;
      }
    }
    
    console.log('No legal description found');
    return '';
  }

  extractRecordingInfo(text) {
    const info = {};
    
    // Recording date
    const dateMatch = text.match(/(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+\d{1,2}\s+\d{4}/i);
    if (dateMatch) {
      info.recordingDate = dateMatch[0];
    }
    
    // Document number
    const docMatch = text.match(/(?:No\.|#)\s*(\d{6,})/);
    if (docMatch) {
      info.documentNumber = docMatch[1];
    }
    
    return info;
  }

  parseNames(fullName) {
    if (!fullName) return { name1: '', name2: '' };
    
    // Check for "and" separator
    if (/\s+and\s+/i.test(fullName)) {
      const parts = fullName.split(/\s+and\s+/i);
      return {
        name1: this.cleanName(parts[0]),
        name2: this.cleanName(parts[1])
      };
    }
    
    // Check for "&" separator
    if (/\s*&\s*/.test(fullName)) {
      const parts = fullName.split(/\s*&\s*/);
      return {
        name1: this.cleanName(parts[0]),
        name2: this.cleanName(parts[1])
      };
    }
    
    // Single name
    return {
      name1: fullName.trim(),
      name2: ''
    };
  }

  cleanName(name) {
    if (!name) return '';
    
    return name
      .replace(/\s+/g, ' ')
      .replace(/,.*$/, '') // Remove everything after comma
      .replace(/\b(Mr\.|Mrs\.|Ms\.|Dr\.)\s*/gi, '')
      .replace(/\b(Husband|Wife|Trustee|Trust)\b.*/gi, '')
      .trim();
  }
}

// Export singleton instance
const ocrService = new OCRService();
export default ocrService;
