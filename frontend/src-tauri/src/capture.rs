use base64::{engine::general_purpose, Engine as _};
use image::ImageEncoder;
use screenshots::Screen;
use std::io::Cursor;

pub fn take_screenshot() -> Result<String, String> {
    let screens = Screen::all().map_err(|e| format!("Failed to enumerate screens: {}", e))?;
    let screen = screens.into_iter().next().ok_or("No screens found")?;

    let image = screen
        .capture()
        .map_err(|e| format!("Failed to capture screen: {}", e))?;

    // Convert to PNG bytes
    let rgba = image.rgba();
    let width = image.width();
    let height = image.height();

    let mut png_bytes = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(Cursor::new(&mut png_bytes));
    encoder
        .write_image(rgba, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    Ok(general_purpose::STANDARD.encode(&png_bytes))
}
