"""
Utility functions for generating QR codes with text overlay
"""
import qrcode
from PIL import Image, ImageDraw, ImageFont
import io
from typing import Optional


def generate_qr_with_overlay(
    payment_uri: str,
    bot_username: str,
    invoice_id: str,
    address: str,
    amount: str,
    currency: str
) -> io.BytesIO:
    """
    Generate a QR code image with text overlay containing bot username, invoice ID, address, and amount
    
    Args:
        payment_uri: The payment URI to encode in the QR code
        bot_username: Bot username (e.g., "mybot")
        invoice_id: Invoice ID
        address: Payment address
        amount: Payment amount
        currency: Currency code (e.g., "BTC")
    
    Returns:
        BytesIO object containing the PNG image
    """
    # Create QR code data - just the payment URI (normal QR code, no embedded metadata)
    qr_data = payment_uri
    
    # Generate QR code - make it large to fill most of the image
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=8,  # Larger size to make QR code bigger
        border=2,  # Reduced border
    )
    qr.add_data(qr_data)
    qr.make(fit=True)
    
    # Create QR code image
    qr_img = qr.make_image(fill_color="black", back_color="white")
    
    # Ensure QR image is in RGB mode (same as main image)
    if qr_img.mode != 'RGB':
        qr_img = qr_img.convert('RGB')
    
    # Calculate dimensions - QR code should be 5px less than border (total, not per side)
    qr_width, qr_height = qr_img.size
    border_diff = 5  # QR will be 5px smaller than image width (about 2-3px padding on each side)
    gap_between_qr_and_text = 150  # Gap between QR code and text (150px total)
    text_estimated_height = 25  # Estimated text height (smaller text)
    bottom_padding = 10  # Padding at bottom of image
    
    # First, determine target image size based on QR code
    # QR width should be image_width - border_diff
    # So: image_width = qr_width + border_diff
    # Height: QR at top (0px) + gap + text + bottom padding
    qr_y = 0  # QR code Y position (0px from top, moved up 20px away from text)
    target_image_width = qr_width + border_diff
    target_image_height = qr_y + qr_height + gap_between_qr_and_text + text_estimated_height + bottom_padding
    
    # Make image square - use the larger dimension, but ensure we have space for text
    if target_image_width > target_image_height:
        total_width = target_image_width
        total_height = target_image_width
        # Recalculate to ensure we have enough height for QR + gap + text + padding
        min_required_height = qr_y + qr_height + gap_between_qr_and_text + text_estimated_height + bottom_padding
        if total_height < min_required_height:
            total_height = min_required_height
            total_width = total_height  # Keep it square
            # Recalculate QR width to maintain 5px border
            target_qr_width = total_width - border_diff
            if qr_width != target_qr_width:
                scale = target_qr_width / qr_width
                qr_img = qr_img.resize((target_qr_width, int(qr_height * scale)), Image.Resampling.LANCZOS)
                qr_width, qr_height = target_qr_width, int(qr_height * scale)
    else:
        total_width = target_image_height
        total_height = target_image_height
        # Scale QR code to fit: QR width should be total_width - border_diff
        target_qr_width = total_width - border_diff
        if qr_width != target_qr_width:
            scale = target_qr_width / qr_width
            qr_img = qr_img.resize((target_qr_width, int(qr_height * scale)), Image.Resampling.LANCZOS)
            qr_width, qr_height = target_qr_width, int(qr_height * scale)
    
    # Center QR code horizontally in the square
    qr_x_offset = (total_width - qr_width) // 2
    
    # Create new image with white background
    img = Image.new('RGB', (total_width, total_height), color='white')
    draw = ImageDraw.Draw(img)
    
    # Paste QR code at center-top with minimal padding from border
    qr_x = qr_x_offset
    # qr_y was already calculated above
    print(f"[QR Generator] Pasting QR code at ({qr_x}, {qr_y}), QR size: {qr_width}x{qr_height}, Image size: {total_width}x{total_height}")
    print(f"[QR Generator] QR is {total_width - qr_width}px smaller than image width (target: {border_diff}px)")
    img.paste(qr_img, (qr_x, qr_y))
    
    # Try to use a nice font, fallback to default if not available
    font_large = None
    font_medium = None
    font_small = None
    
    try:
        # Try to use a larger font (Windows)
        font_large = ImageFont.truetype("arial.ttf", 28)
        font_medium = ImageFont.truetype("arial.ttf", 20)
        font_small = ImageFont.truetype("arial.ttf", 16)
    except:
        try:
            # Try Linux fonts
            font_large = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
            font_medium = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 20)
            font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 16)
        except:
            try:
                # Try macOS fonts
                font_large = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 28)
                font_medium = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 20)
                font_small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 16)
            except:
                # Fallback to default font - scale it up
                try:
                    default_font = ImageFont.load_default()
                    # Try to create a larger default font
                    font_large = default_font
                    font_medium = default_font
                    font_small = default_font
                except:
                    pass
    
    # Debug: Print what we're drawing
    print(f"[QR Generator] Bot username: {bot_username}, Invoice ID: {invoice_id}")
    print(f"[QR Generator] Image size: {total_width}x{total_height}, QR size: {qr_width}x{qr_height}")
    print(f"[QR Generator] Fonts loaded - Large: {font_large is not None}, Medium: {font_medium is not None}, Small: {font_small is not None}")
    
    # Create text for below QR code: @botusername • Invoice {invoice_id}
    username_text = f"@{bot_username}" if bot_username else "Bot"
    single_line_text = f"{username_text} • Invoice {invoice_id}"
    
    # Calculate available width for text (with padding on both sides)
    text_padding = 10  # Padding for text on sides
    max_text_width = total_width - (text_padding * 2)
    
    # Try different font sizes to find one that fits
    text_font = None
    font_size = 20
    text_width = 0
    text_height = 0
    
    # Try to find a font size that fits - start with smaller sizes for text below QR
    for test_size in [14, 12, 10, 16, 18]:
        try:
            test_font = ImageFont.truetype("arial.ttf", test_size)
        except:
            try:
                test_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", test_size)
            except:
                try:
                    test_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", test_size)
                except:
                    test_font = font_medium if font_medium else font_small
                    break
        
        try:
            bbox = draw.textbbox((0, 0), single_line_text, font=test_font)
            test_width = bbox[2] - bbox[0]
            test_height = bbox[3] - bbox[1]
        except:
            try:
                test_width, test_height = draw.textsize(single_line_text, font=test_font)
            except:
                test_width = len(single_line_text) * (test_size // 2)
                test_height = test_size
        
        if test_width <= max_text_width:
            text_font = test_font
            text_width = test_width
            text_height = test_height
            break
    
    # If no font fits, use smallest available
    if not text_font:
        text_font = font_small if font_small else font_medium if font_medium else None
        if text_font:
            try:
                bbox = draw.textbbox((0, 0), single_line_text, font=text_font)
                text_width = bbox[2] - bbox[0]
                text_height = bbox[3] - bbox[1]
            except:
                try:
                    text_width, text_height = draw.textsize(single_line_text, font=text_font)
                except:
                    text_width = len(single_line_text) * 6
                    text_height = 20
        else:
            text_width = len(single_line_text) * 6
            text_height = 20
    
    # If text is still too wide, truncate it
    if text_width > max_text_width:
        # Try shorter versions
        shorter_options = [
            f"{username_text} • Inv {invoice_id}",
            f"@{bot_username[:15] if len(bot_username) > 15 else bot_username} • {invoice_id}",
            f"Invoice {invoice_id}",
        ]
        for option in shorter_options:
            if text_font:
                try:
                    bbox = draw.textbbox((0, 0), option, font=text_font)
                    test_width = bbox[2] - bbox[0]
                except:
                    test_width = len(option) * 6
            else:
                test_width = len(option) * 6
            
            if test_width <= max_text_width:
                single_line_text = option
                text_width = test_width
                break
    
    # Position text directly under the QR code
    # QR code ends at qr_y + qr_height, so place text right below it with a small gap
    # gap_between_qr_and_text was already defined above
    text_y_start = qr_y + qr_height + gap_between_qr_and_text
    
    # Center text horizontally
    x_position = (total_width - text_width) // 2  # Center horizontally
    y_position = text_y_start  # Position directly under QR code
    
    # Verify text is within image bounds
    text_bottom = y_position + text_height
    if text_bottom > total_height:
        # Adjust y_position to fit within image
        y_position = total_height - text_height - bottom_padding
        print(f"[QR Generator] WARNING: Text would overflow, adjusted y_position to {y_position}")
    
    print(f"[QR Generator] Drawing text at: ({x_position}, {y_position})")
    print(f"[QR Generator] Text dimensions: width={text_width}, height={text_height}")
    print(f"[QR Generator] Image dimensions: {total_width}x{total_height}")
    print(f"[QR Generator] QR code ends at y={qr_y + qr_height}, text starts at y={y_position}")
    print(f"[QR Generator] Text: {single_line_text}")
    print(f"[QR Generator] Text fits horizontally: {text_width <= max_text_width}")
    print(f"[QR Generator] Text fits vertically: {y_position + text_height <= total_height}")
    
    # Draw a background rectangle for text to ensure visibility
    text_bg_padding = 5
    text_bg_y1 = y_position - text_bg_padding
    text_bg_y2 = y_position + text_height + text_bg_padding
    text_bg_x1 = max(0, x_position - text_bg_padding)
    text_bg_x2 = min(total_width, x_position + text_width + text_bg_padding)
    draw.rectangle([(text_bg_x1, text_bg_y1), (text_bg_x2, text_bg_y2)], fill='white', outline='lightgray', width=1)
    
    # Draw text with outline for better visibility
    if text_font:
        # Draw outline first (black outline for contrast on white background)
        for adj in [(-1,-1), (-1,1), (1,-1), (1,1), (0,-1), (0,1), (-1,0), (1,0)]:
            draw.text((x_position + adj[0], y_position + adj[1]), single_line_text, fill='white', font=text_font)
        draw.text((x_position, y_position), single_line_text, fill='black', font=text_font)
    else:
        draw.text((x_position, y_position), single_line_text, fill='black')
    
    # Verify final image dimensions
    try:
        final_width, final_height = img.size
        print(f"[QR Generator] Final image size: {final_width}x{final_height}")
    except Exception as e:
        print(f"[QR Generator] Error getting final image size: {e}")
        import traceback
        traceback.print_exc()
    
    # Debug: Save a test image to verify text is drawn BEFORE converting to bytes
    try:
        import os
        current_dir = os.path.dirname(os.path.abspath(__file__))
        test_path = os.path.join(current_dir, "test_qr_debug.png")
        print(f"[QR Generator] Attempting to save test image to: {test_path}")
        img.save(test_path)
        print(f"[QR Generator] Saved test image to {test_path}")
        print(f"[QR Generator] Please check this file to verify text is visible")
    except Exception as e:
        print(f"[QR Generator] Could not save test image: {e}")
        import traceback
        traceback.print_exc()
    
    # Convert to bytes - IMPORTANT: Make sure we're using the same image object
    try:
        img_bytes = io.BytesIO()
        # Verify image still has correct size before saving
        verify_width, verify_height = img.size
        print(f"[QR Generator] Verifying image before saving to bytes: {verify_width}x{verify_height}")
        img.save(img_bytes, format='PNG')
        img_bytes.seek(0)
        
        # Verify bytes were written
        img_bytes.seek(0, 2)  # Seek to end
        byte_size = img_bytes.tell()
        img_bytes.seek(0)  # Reset to beginning
        print(f"[QR Generator] Image bytes size: {byte_size} bytes")
        print(f"[QR Generator] QR code image generated successfully, size: {total_width}x{total_height}")
        
        return img_bytes
    except Exception as e:
        print(f"[QR Generator] Error converting image to bytes: {e}")
        import traceback
        traceback.print_exc()
        raise

