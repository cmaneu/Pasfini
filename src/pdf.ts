// PDF export using jsPDF
import { jsPDF } from 'jspdf';
import type { Issue, Room } from './types.ts';
import { getPhotosByIssue } from './db.ts';
import { blobToDataUrl } from './photos.ts';

export async function exportPDF(issues: Issue[], rooms: Room[]): Promise<void> {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const roomMap = new Map(rooms.map((r) => [r.slug, r.name]));

  // Title
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('Réserves chantier — Pasfini', margin, y + 7);
  y += 14;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Exporté le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, margin, y);
  y += 4;

  const openCount = issues.filter((i) => i.status === 'open').length;
  const doneCount = issues.filter((i) => i.status === 'done').length;
  doc.text(`${issues.length} réserve(s) — ${openCount} ouverte(s), ${doneCount} terminée(s)`, margin, y);
  y += 10;

  // Group by room
  const grouped = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = grouped.get(issue.roomSlug) || [];
    list.push(issue);
    grouped.set(issue.roomSlug, list);
  }

  const sortedSlugs = [...grouped.keys()].sort((a, b) =>
    (roomMap.get(a) || a).localeCompare(roomMap.get(b) || b, 'fr')
  );

  for (const slug of sortedSlugs) {
    const roomIssues = grouped.get(slug)!;
    const roomName = roomMap.get(slug) || slug;

    // Check if we need a new page
    if (y > 260) {
      doc.addPage();
      y = margin;
    }

    // Room header
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setFillColor(219, 234, 254); // blue-100
    doc.roundedRect(margin, y - 4, contentWidth, 9, 1, 1, 'F');
    doc.text(roomName, margin + 3, y + 2);
    y += 10;

    for (const issue of roomIssues) {
      if (y > 250) {
        doc.addPage();
        y = margin;
      }

      // Status indicator
      const statusText = issue.status === 'done' ? '✓' : '○';
      const statusColor = issue.status === 'done' ? [22, 163, 74] : [234, 179, 8];
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
      doc.text(statusText, margin + 2, y + 1);

      // Title
      doc.setTextColor(31, 41, 55); // gray-800
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(issue.title, margin + 10, y + 1);
      y += 5;

      // Description
      if (issue.description) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(75, 85, 99); // gray-600
        const lines = doc.splitTextToSize(issue.description, contentWidth - 10);
        doc.text(lines, margin + 10, y + 1);
        y += lines.length * 4;
      }

      // Date
      doc.setFontSize(8);
      doc.setTextColor(156, 163, 175); // gray-400
      const dateStr = new Date(issue.createdAt).toLocaleDateString('fr-FR');
      doc.text(dateStr, margin + 10, y + 1);
      y += 4;

      // Photos
      try {
        const photos = await getPhotosByIssue(issue.id);
        if (photos.length > 0) {
          let photoX = margin + 10;
          const photoSize = 35;
          const photosPerRow = Math.floor((contentWidth - 10) / (photoSize + 3));

          for (let i = 0; i < photos.length; i++) {
            if (y + photoSize > 275) {
              doc.addPage();
              y = margin;
              photoX = margin + 10;
            }

            try {
              const dataUrl = await blobToDataUrl(photos[i].blob);
              doc.addImage(dataUrl, 'JPEG', photoX, y, photoSize, photoSize);
              photoX += photoSize + 3;

              if ((i + 1) % photosPerRow === 0) {
                photoX = margin + 10;
                y += photoSize + 3;
              }
            } catch {
              // Skip failed photos
            }
          }
          y += photoSize + 5;
        }
      } catch {
        // Skip photos on error
      }

      y += 3;
    }

    y += 5;
  }

  doc.save('pasfini-reserves.pdf');
}
