const { PDFDocument } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');

async function extractFields(filename) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Extracting fields from: ${filename}`);
  console.log('='.repeat(60));
  
  try {
    const pdfPath = path.join('templates', filename);
    const pdfBytes = await fs.readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    
    console.log(`\nTotal fields found: ${fields.length}\n`);
    
    // Group fields by type
    const textFields = [];
    const checkBoxes = [];
    const radioGroups = [];
    const dropdowns = [];
    const others = [];
    
    fields.forEach((field, index) => {
      const name = field.getName();
      const type = field.constructor.name;
      
      const fieldInfo = {
        index: index + 1,
        name: name,
        type: type
      };
      
      switch(type) {
        case 'PDFTextField':
          textFields.push(fieldInfo);
          break;
        case 'PDFCheckBox':
          checkBoxes.push(fieldInfo);
          break;
        case 'PDFRadioGroup':
          radioGroups.push(fieldInfo);
          break;
        case 'PDFDropdown':
          dropdowns.push(fieldInfo);
          break;
        default:
          others.push(fieldInfo);
      }
    });
    
    // Print organized output
    if (textFields.length > 0) {
      console.log('TEXT FIELDS:');
      console.log('-'.repeat(50));
      textFields.forEach(f => {
        console.log(`  ${f.index}. ${f.name}`);
      });
      console.log();
    }
    
    if (checkBoxes.length > 0) {
      console.log('CHECKBOXES:');
      console.log('-'.repeat(50));
      checkBoxes.forEach(f => {
        console.log(`  ${f.index}. ${f.name}`);
      });
      console.log();
    }
    
    if (radioGroups.length > 0) {
      console.log('RADIO GROUPS:');
      console.log('-'.repeat(50));
      radioGroups.forEach(f => {
        console.log(`  ${f.index}. ${f.name}`);
      });
      console.log();
    }
    
    if (dropdowns.length > 0) {
      console.log('DROPDOWNS:');
      console.log('-'.repeat(50));
      dropdowns.forEach(f => {
        console.log(`  ${f.index}. ${f.name}`);
      });
      console.log();
    }
    
    if (others.length > 0) {
      console.log('OTHER FIELDS:');
      console.log('-'.repeat(50));
      others.forEach(f => {
        console.log(`  ${f.index}. ${f.name} (${f.type})`);
      });
      console.log();
    }
    
    // Save detailed field mappings to JSON
    const fieldMap = {
      filename: filename,
      totalFields: fields.length,
      extractedAt: new Date().toISOString(),
      fields: {
        text: textFields,
        checkboxes: checkBoxes,
        radioGroups: radioGroups,
        dropdowns: dropdowns,
        others: others
      },
      allFields: fields.map((field, index) => ({
        index: index + 1,
        name: field.getName(),
        type: field.constructor.name
      }))
    };
    
    const outputFilename = filename.replace('.pdf', '_fields.json');
    const outputPath = path.join('templates', outputFilename);
    await fs.writeFile(outputPath, JSON.stringify(fieldMap, null, 2));
    
    console.log(`\n✓ Field mappings saved to: ${outputFilename}`);
    
    // Also create a simplified mapping file for common fields
    const simplifiedMap = createSimplifiedMapping(fields, filename);
    const simplifiedFilename = filename.replace('.pdf', '_mapping.json');
    const simplifiedPath = path.join('templates', simplifiedFilename);
    await fs.writeFile(simplifiedPath, JSON.stringify(simplifiedMap, null, 2));
    
    console.log(`✓ Simplified mappings saved to: ${simplifiedFilename}`);
    
  } catch (error) {
    console.error(`\n✗ Error processing ${filename}:`, error.message);
  }
}

function createSimplifiedMapping(fields, filename) {
  // Try to identify common PCOR fields
  const mapping = {
    county: filename.split('_')[0].toLowerCase(),
    mappedFields: {},
    unmappedFields: []
  };
  
  fields.forEach(field => {
    const name = field.getName();
    const lowerName = name.toLowerCase();
    
    // Try to identify common fields by patterns
    if (lowerName.includes('buyer') && lowerName.includes('name')) {
      mapping.mappedFields.buyerName = name;
    } else if (lowerName.includes('buyer') && lowerName.includes('address')) {
      mapping.mappedFields.buyerAddress = name;
    } else if (lowerName.includes('buyer') && lowerName.includes('phone')) {
      mapping.mappedFields.buyerPhone = name;
    } else if (lowerName.includes('buyer') && lowerName.includes('email')) {
      mapping.mappedFields.buyerEmail = name;
    } else if (lowerName.includes('seller') || lowerName.includes('transferor')) {
      mapping.mappedFields.sellerName = name;
    } else if (lowerName.includes('apn') || lowerName.includes('parcel')) {
      mapping.mappedFields.apn = name;
    } else if (lowerName.includes('property') && lowerName.includes('address')) {
      mapping.mappedFields.propertyAddress = name;
    } else if (lowerName.includes('purchase') && lowerName.includes('price')) {
      mapping.mappedFields.purchasePrice = name;
    } else if (lowerName.includes('down') && lowerName.includes('payment')) {
      mapping.mappedFields.downPayment = name;
    } else if (lowerName.includes('principal') && lowerName.includes('residence')) {
      mapping.mappedFields.principalResidence = name;
    } else {
      mapping.unmappedFields.push(name);
    }
  });
  
  return mapping;
}

async function main() {
  console.log('\nPCOR FIELD EXTRACTION TOOL');
  console.log('==========================\n');
  
  // Check if templates directory exists
  try {
    await fs.access('templates');
  } catch {
    console.log('Creating templates directory...');
    await fs.mkdir('templates', { recursive: true });
  }
  
  // List of PDF files to process
  const files = [
    'RIVERSIDE_County_Form_BOE-502-A_for_2018__6_.pdf',
    'SAN_BERNARDINO_County_Form_BOE-502-A_for_2025__23_.pdf',
    'VENTURA_County_Form_BOE-502-A_for_2022__14_.pdf',
    'ORANGE_County_Form_BOE-502-A_for_2021__18_.pdf',
    'preliminary-change-of-ownership__1_.pdf'
  ];
  
  let processedCount = 0;
  
  for (const file of files) {
    try {
      await fs.access(path.join('templates', file));
      await extractFields(file);
      processedCount++;
    } catch {
      console.log(`\n⚠ Skipping ${file} - File not found in templates/`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`EXTRACTION COMPLETE: ${processedCount} files processed`);
  console.log('='.repeat(60) + '\n');
  
  if (processedCount === 0) {
    console.log('⚠ No PDF files found in templates directory.');
    console.log('  Please add the PCOR PDF files to the templates/ folder and run again.\n');
  }
}

// Run the extraction
main().catch(console.error);
