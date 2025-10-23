const express = require('express');
const bodyParser = require('body-parser');
const PDFKit = require('pdfkit');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(bodyParser.json());

// Mock data for user items
const items = [
  {
    id: '1',
    title: 'Vintage Coin',
    thumbnailUrl: 'https://example.com/coin.jpg',
    keyFields: { date: '1900', origin: 'USA', medium: 'Metal' },
    aiNote: 'A rare coin from the early 20th century.'
  },
  {
    id: '2',
    title: 'Antique Vase',
    thumbnailUrl: 'https://example.com/vase.jpg',
    keyFields: { date: '1800', origin: 'China', medium: 'Ceramic' },
    aiNote: 'A beautiful ceramic vase with intricate designs.'
  }
];

// Endpoint to fetch user items
app.get('/api/items', (req, res) => {
  res.json(items);
});

// Endpoint to generate tags
app.post('/api/tag-generator', async (req, res) => {
  try {
    const { itemIds, template, pageSize, orientation, options } = req.body;

    console.log('Received Payload:', { itemIds, template, pageSize, orientation, options });

    // Filter selected items
    const selectedItems = items.filter(item => itemIds.includes(item.id));
    console.log('Selected Items:', selectedItems);

    if (selectedItems.length === 0) {
      throw new Error('No items selected');
    }

    // Generate PDF
    const pdfPath = path.join(__dirname, 'output', 'tags.pdf');
    const doc = new PDFKit({ size: pageSize, layout: orientation });
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    for (const item of selectedItems) {
      doc.fontSize(20).text(item.title, { align: 'center' });
      doc.fontSize(14).text(item.aiNote, { align: 'center' });
      if (options.showThumbnail && item.thumbnailUrl) {
        doc.image(item.thumbnailUrl, { fit: [100, 100], align: 'center' });
      }
      if (options.showQRCode) {
        const qrCodeData = await QRCode.toDataURL(`https://example.com/item/${item.id}`);
        doc.image(qrCodeData, { fit: [100, 100], align: 'center' });
      }
      doc.addPage();
    }

    doc.end();

    writeStream.on('finish', () => {
      console.log('PDF generated successfully:', pdfPath);
      res.json({ pdfUrl: `/api/output/tags.pdf`, svgUrl: `/api/output/tags.svg` });
    });
  } catch (error) {
    console.error('Error generating tags:', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve generated files
app.use('/api/output', express.static(path.join(__dirname, 'output')));

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
