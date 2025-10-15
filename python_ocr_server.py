#!/usr/bin/env python3
"""
Enhanced Python OCR Server for Trust Transfer Deed Automation
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
import tempfile
import os
import re
from pdf2image import convert_from_path
import pytesseract
from PIL import Image, ImageEnhance, ImageFilter

app = Flask(__name__)
CORS(app)

def preprocess_image(image):
    """Enhance image quality for better OCR results"""
    image = image.convert('L')
    enhancer = ImageEnhance.Contrast(image)
    image = enhancer.enhance(2.0)
    enhancer = ImageEnhance.Sharpness(image)
    image = enhancer.enhance(2.0)
    image = image.filter(ImageFilter.MedianFilter(3))
    return image

def extract_from_pdf(pdf_path):
    """Extract text from PDF using OCR with image preprocessing"""
    print("Converting PDF to images at high DPI...")
    images = convert_from_path(pdf_path, dpi=400)
    full_text = ""
    
    for page_num, image in enumerate(images, 1):
        print(f"Processing page {page_num}/{len(images)}...")
        processed_image = preprocess_image(image)
        custom_config = r'--oem 3 --psm 6'
        text = pytesseract.image_to_string(processed_image, 
config=custom_config)
        full_text += text + "\n\n"
        print(f"Extracted {len(text)} characters from page {page_num}")
    
    return full_text

def clean_text(text):
    """Clean and normalize extracted text"""
    text = re.sub(r'\s+', ' ', text)
    text = re.sub(r'[^\x00-\x7F]+', '', text)
    return text.strip()

def extract_grantee(text):
    """Extract grantee (buyer) names"""
    print("=== EXTRACTING GRANTEE ===")
    patterns = [
        
r'GRANT(?:S)?\s+(?:\([A-Z]\))?\s+TO\s+\*?\s*([A-Z][a-z]+\s+[A-Z][a-z]+\s+and\s+[A-Z][a-z]+\s+[A-Z][a-z]+)',
        
r'GRANT(?:S)?\s+(?:\([A-Z]\))?\s+TO\s+\*?\s*([^,\n]+?)(?=\s*,\s*(?:Husband|Wife|as\s+Joint|Trustee))',
        
r'hereby\s+GRANT(?:S)?\s+(?:\([A-Z]\))?\s+TO\s+\*?\s*([A-Z][^\n,]+?)(?:\s*,\s*(?:Husband|Wife|as|whose))',
    ]
    
    for i, pattern in enumerate(patterns):
        match = re.search(pattern, text, re.IGNORECASE)
        if match and match.group(1):
            name = clean_name(match.group(1))
            if name and len(name) > 5:
                print(f"Found grantee with pattern {i}: {name}")
                return name
    
    print("No grantee found")
    return ''

def extract_property_address(text):
    """Extract property address"""
    print("=== EXTRACTING PROPERTY ADDRESS ===")
    result = {'address': '', 'city': '', 'zip': ''}
    
    address_patterns = [
        
r'(\d{1,5}\s+(?:North|South|East|West|N|S|E|W)?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Boulevard|Blvd)\.?)',
    ]
    
    for i, pattern in enumerate(address_patterns):
        match = re.search(pattern, text, re.IGNORECASE)
        if match and match.group(1):
            addr = match.group(1).strip()
            addr = re.sub(r'\s+', ' ', addr)
            if len(addr) > 5 and any(char.isdigit() for char in addr):
                result['address'] = addr
                print(f"Found address: {addr}")
                break
    
    city_match = re.search(r'([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)[,\s]+(?:CA|California)', text)
    if city_match:
        result['city'] = city_match.group(1).strip()
        print(f"Found city: {result['city']}")
    
    zip_match = re.search(r'\b(9\d{4})(?:-\d{4})?\b', text)
    if zip_match:
        result['zip'] = zip_match.group(1)
        print(f"Found ZIP: {result['zip']}")
    
    return result

def extract_apn(text):
    """Extract APN"""
    print("=== EXTRACTING APN ===")
    patterns = [
        
r"Assessor['\u2019]?s\s+Parcel\s+No\.?\s*[:\s]*(\d{3,4}[-\s]?\d{1,4}[-\s]?\d{1,4})",
        r'(?:APN|A\.P\.N\.)[:\s]*(\d{3,4}[-\s]\d{3,4}[-\s]\d{2,4})',
    ]
    
    for i, pattern in enumerate(patterns):
        match = re.search(pattern, text, re.IGNORECASE)
        if match and match.group(1):
            apn = match.group(1)
            apn = re.sub(r'\s+', '-', apn)
            print(f"Found APN: {apn}")
            return apn
    
    print("No APN found")
    return ''

def extract_legal_description(text):
    """Extract legal description"""
    print("=== EXTRACTING LEGAL DESCRIPTION ===")
    patterns = [
        
r'((?:Lot|LOT)\s+\d+[^\.]{0,500}?(?:Tract|TRACT|Map|MAP)\s+(?:No\.?\s*)?\d+[^\.]{0,300}?\.)',
        r'(THE\s+(?:NORTH|SOUTH|EAST|WEST)[^\.]{50,800}?\.)',
    ]
    
    for i, pattern in enumerate(patterns):
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if match and match.group(1):
            desc = match.group(1)
            desc = re.sub(r'\s+', ' ', desc).strip()
            if len(desc) > 30:
                desc = desc[:800]
                print(f"Found legal description: {desc[:100]}...")
                return desc
    
    print("No legal description found")
    return ''

def clean_name(name):
    """Clean up extracted names"""
    if not name:
        return ''
    name = re.sub(r'\b(Husband|Wife|Trustee|Trust)\b.*', '', name, 
flags=re.IGNORECASE)
    name = re.sub(r'\s+', ' ', name)
    name = name.strip(' ,;:.-*')
    return name

def parse_names(full_name):
    """Parse full name into two separate names"""
    if not full_name:
        return {'name1': '', 'name2': ''}
    
    if re.search(r'\s+and\s+', full_name, re.IGNORECASE):
        parts = re.split(r'\s+and\s+', full_name, flags=re.IGNORECASE)
        return {
            'name1': clean_name(parts[0]),
            'name2': clean_name(parts[1]) if len(parts) > 1 else ''
        }
    
    return {'name1': full_name.strip(), 'name2': ''}

@app.route('/ocr', methods=['POST'])
def process_deed():
    """Process uploaded deed PDF and extract information"""
    try:
        data = request.json
        deed_base64 = data.get('deed', '')
        
        if not deed_base64:
            return jsonify({'success': False, 'error': 'No deed data provided'})
        
        print("\n" + "="*50)
        print("PROCESSING NEW DEED")
        print("="*50)
        
        pdf_bytes = base64.b64decode(deed_base64)
        
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
            tmp_file.write(pdf_bytes)
            tmp_path = tmp_file.name
        
        try:
            print("Starting OCR extraction...")
            raw_text = extract_from_pdf(tmp_path)
            print(f"Extracted {len(raw_text)} characters total")
            
            clean_text_result = clean_text(raw_text)
            
            print("\nExtracting structured information...")
            
            grantee = extract_grantee(clean_text_result)
            parsed_names = parse_names(grantee)
            
            property_info = extract_property_address(clean_text_result)
            apn = extract_apn(clean_text_result)
            legal_desc = extract_legal_description(clean_text_result)
            
            extracted_info = {
                'grantee': grantee,
                'grantor1': parsed_names['name1'],
                'grantor2': parsed_names['name2'],
                'propertyAddress': property_info['address'],
                'propertyCity': property_info['city'],
                'propertyState': 'CA',
                'propertyZip': property_info['zip'],
                'apn': apn,
                'legalDescription': legal_desc,
                'documentType': 'GRANT DEED'
            }
            
            print("\n=== EXTRACTION SUMMARY ===")
            print(f"Grantee: {grantee}")
            print(f"Grantor 1: {parsed_names['name1']}")
            print(f"Grantor 2: {parsed_names['name2']}")
            print(f"Address: {property_info['address']}")
            print(f"City: {property_info['city']}")
            print(f"ZIP: {property_info['zip']}")
            print(f"APN: {apn}")
            print("="*50 + "\n")
            
            return jsonify({
                'success': True,
                'extractedInfo': extracted_info,
                'rawText': raw_text[:2000]
            })
            
        finally:
            try:
                os.unlink(tmp_path)
            except:
                pass
    
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/', methods=['GET'])
def index():
    """Health check endpoint"""
    return jsonify({'status': 'running', 'service': 'Python OCR Server'})

if __name__ == '__main__':
    print("\n" + "="*60)
    print("🚀 ENHANCED PYTHON OCR SERVER STARTING")
    print("="*60)
    print("Running on: http://localhost:5001")
    print("="*60 + "\n")
    
    app.run(port=5001, debug=True, host='0.0.0.0')
