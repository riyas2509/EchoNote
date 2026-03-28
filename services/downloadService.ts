import { jsPDF } from "jspdf";

export const executeDownload = async (fileName: string, contentUrl: string, format: string) => {
  try {
    let finalUrl = contentUrl;
    
    // For cross-origin URLs (like remote audio), we fetch them to ensure download works
    if (contentUrl.startsWith('http') && !contentUrl.includes(window.location.host)) {
      try {
        const response = await fetch(contentUrl);
        const blob = await response.blob();
        finalUrl = URL.createObjectURL(blob);
      } catch (err) {
        console.error("Failed to fetch remote asset for download:", err);
        // Fallback to original URL if fetch fails (might still work if CORS allows)
      }
    }

    const a = document.createElement('a');
    a.href = finalUrl;
    a.download = `${fileName}.${format.toLowerCase()}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Cleanup blob URL if we created one
    if (finalUrl !== contentUrl && finalUrl.startsWith('blob:')) {
      setTimeout(() => URL.revokeObjectURL(finalUrl), 1000);
    }
  } catch (err) {
    console.error("Download execution failed:", err);
    throw err;
  }
};

export const generateTranscriptBlob = (segments: { speaker: string, text: string, isBookmarked: boolean }[], format: string): string => {
  const fmt = format.toLowerCase();
  
  if (fmt === 'pdf') {
    const doc = new jsPDF();
    let y = 20;
    const pageHeight = doc.internal.pageSize.height;
    const margin = 15;
    const maxWidth = 180;

    segments.forEach((seg) => {
      const prefix = `[${seg.speaker}]: `;
      const fullText = `${prefix}${seg.text}`;
      
      if (seg.isBookmarked) {
        doc.setFont("helvetica", "bold");
      } else {
        doc.setFont("helvetica", "normal");
      }

      const splitText = doc.splitTextToSize(fullText, maxWidth);
      
      splitText.forEach((line: string) => {
        if (y > pageHeight - 20) {
          doc.addPage();
          y = 20;
          // Re-apply font on new page
          if (seg.isBookmarked) doc.setFont("helvetica", "bold");
          else doc.setFont("helvetica", "normal");
        }
        doc.text(line, margin, y);
        y += 7;
      });
      y += 3; // Extra space between segments
    });
    
    const blob = doc.output('blob');
    return URL.createObjectURL(blob);
  } else if (fmt === 'docx') {
    // Basic HTML wrapper that Word can open
    const htmlSegments = segments.map(seg => {
      const text = seg.isBookmarked ? `<b>[${seg.speaker}]: ${seg.text}</b>` : `[${seg.speaker}]: ${seg.text}`;
      return text;
    }).join('<br><br>');

    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>Transcript</title></head>
      <body>${htmlSegments}</body>
      </html>
    `;
    const blob = new Blob([htmlContent], { type: 'application/msword' });
    return URL.createObjectURL(blob);
  } else {
    // Default to TXT
    const textContent = segments.map(seg => {
      const text = seg.isBookmarked ? `**[${seg.speaker}]: ${seg.text}**` : `[${seg.speaker}]: ${seg.text}`;
      return text;
    }).join('\n\n');
    const blob = new Blob([textContent], { type: 'text/plain' });
    return URL.createObjectURL(blob);
  }
};
