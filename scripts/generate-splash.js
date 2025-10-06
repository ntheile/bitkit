const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Splash screen configurations
const splashConfigs = [
  {
    name: 'White background with green logo (contain)',
    svgPath: 'images/zaprite-splash-green.svg',
    backgroundColor: '#ffffff',
    fit: 'contain',
  },
  {
    name: 'Teal background with light logo (contain)',
    svgPath: 'images/zaprite-light.svg',
    backgroundColor: '#20c997',
    fit: 'contain',
  }
];

// iOS splash sizes
const iosSizes = [
  { width: 1125, height: 2436, name: 'Splash@3x.png' },  // iPhone X, 11 Pro, 12 Pro
  { width: 750, height: 1334, name: 'Splash@2x.png' },   // iPhone 6/7/8
  { width: 375, height: 667, name: 'Splash.png' },       // iPhone SE
];

// Android splash logo sizes (for different densities)
// These are centered logos that appear on top of the background color
// Smaller sizes to prevent stretching (roughly 200dp converted to pixels)
const androidSizes = [
  { width: 200, height: 200, name: 'splash_logo.png', folder: 'drawable-mdpi' },      // mdpi (1x)
  { width: 300, height: 300, name: 'splash_logo.png', folder: 'drawable-hdpi' },      // hdpi (1.5x)
  { width: 400, height: 400, name: 'splash_logo.png', folder: 'drawable-xhdpi' },     // xhdpi (2x)
  { width: 600, height: 600, name: 'splash_logo.png', folder: 'drawable-xxhdpi' },    // xxhdpi (3x)
  { width: 800, height: 800, name: 'splash_logo.png', folder: 'drawable-xxxhdpi' },   // xxxhdpi (4x)
];

async function generateSplash() {
  console.log('=== Splash Screen Generator ===\n');
  
  // Let user choose which configuration to generate
  const configIndex = process.argv[2] ? parseInt(process.argv[2]) - 1 : 0;
  
  if (configIndex < 0 || configIndex >= splashConfigs.length) {
    console.log('Usage: node generate-splash.js [config-number]');
    console.log('\nAvailable configurations:');
    splashConfigs.forEach((config, i) => {
      console.log(`  ${i + 1}. ${config.name}`);
    });
    console.log('\nDefaulting to configuration 1...\n');
  }
  
  const config = splashConfigs[Math.max(0, Math.min(configIndex, splashConfigs.length - 1))];
  const svgPath = path.join(__dirname, config.svgPath);
  
  console.log(`Using configuration: ${config.name}`);
  console.log(`SVG: ${config.svgPath}`);
  console.log(`Background: ${config.backgroundColor}`);
  console.log(`Fit: ${config.fit}\n`);

  // Generate iOS splash screens
  console.log('📱 Generating iOS splash screens...');
  const iosOutputDir = path.join(__dirname, 'ios/bitkit/Images.xcassets/Splash.imageset');

  for (const size of iosSizes) {
    try {
      // Calculate logo size (40% of screen height, but also respect width)
      const maxLogoHeight = Math.floor(size.height * 0.4);
      const maxLogoWidth = Math.floor(size.width * 0.7);
      
      // Resize the logo to fit within constraints
      const logoBuffer = await sharp(svgPath)
        .resize(maxLogoWidth, maxLogoHeight, {
          fit: 'inside',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();

      // Create a background with the brand color and composite the logo
      await sharp({
        create: {
          width: size.width,
          height: size.height,
          channels: 4,
          background: config.backgroundColor
        }
      })
      .composite([{
        input: logoBuffer,
        gravity: 'center'
      }])
      .png()
      .toFile(path.join(iosOutputDir, size.name));
      
      console.log(`  ✓ ${size.name} (${size.width}x${size.height})`);
    } catch (error) {
      console.error(`  ✗ Error generating ${size.name}:`, error.message);
    }
  }

  // Generate Android splash screens
  console.log('\n🤖 Generating Android splash logos...');
  const androidResDir = path.join(__dirname, 'android/app/src/main/res');

  for (const size of androidSizes) {
    const outputDir = path.join(androidResDir, size.folder);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    try {
      // For Android, use transparent background since the logo is overlaid on the brand color
      await sharp(svgPath)
        .resize(size.width, size.height, {
          fit: 'contain',
          position: 'center',
          background: { r: 0, g: 0, b: 0, alpha: 0 } // transparent
        })
        .png()
        .toFile(path.join(outputDir, size.name));
      
      console.log(`  ✓ ${size.folder}/${size.name} (${size.width}x${size.height})`);
    } catch (error) {
      console.error(`  ✗ Error generating ${size.folder}/${size.name}:`, error.message);
    }
  }

  console.log('\n✅ Done! Splash screens generated successfully.');
  console.log('\nTo generate with different configuration:');
  splashConfigs.forEach((cfg, i) => {
    console.log(`  node generate-splash.js ${i + 1}  # ${cfg.name}`);
  });
}

generateSplash().catch(console.error);
