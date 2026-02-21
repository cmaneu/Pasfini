// PDF export using jsPDF
import { jsPDF } from 'jspdf';
import type { Issue, Room, Assignee } from './types.ts';
import { getPhotosByIssue } from './db.ts';
import { blobToDataUrl } from './photos.ts';

function addPageNumbers(doc: jsPDF): void {
  const totalPages = doc.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(156, 163, 175);
    doc.text(`${i} / ${totalPages}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
  }
}

export async function exportPDF(issues: Issue[], rooms: Room[], assignees?: Assignee[]): Promise<void> {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const roomMap = new Map(rooms.map((r) => [r.slug, r.name]));
  const assigneeMap = new Map((assignees || []).map((a) => [a.slug, a.name]));

  // Title
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('Réserves chantier', margin, y + 7);
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
    doc.setTextColor(31, 41, 55);
    doc.setFillColor(219, 234, 254); // blue-100
    doc.roundedRect(margin, y - 4, contentWidth, 9, 1, 1, 'F');
    doc.text(roomName, margin + 3, y + 2);
    y += 10;

    for (const issue of roomIssues) {
      if (y > 250) {
        doc.addPage();
        y = margin;
      }

      // Status indicator — draw a circle/checkmark using PDF primitives
      if (issue.status === 'done') {
        // Filled green circle with white checkmark
        doc.setFillColor(22, 163, 74);
        doc.circle(margin + 4, y - 0.5, 2.5, 'F');
        doc.setDrawColor(255, 255, 255);
        doc.setLineWidth(0.5);
        // Simple check shape: two small lines
        doc.line(margin + 2.8, y - 0.5, margin + 3.8, y + 0.5);
        doc.line(margin + 3.8, y + 0.5, margin + 5.3, y - 1.5);
      } else {
        // Open yellow circle
        doc.setDrawColor(234, 179, 8);
        doc.setLineWidth(0.5);
        doc.circle(margin + 4, y - 0.5, 2.5, 'S');
      }

      // Title
      doc.setTextColor(31, 41, 55); // gray-800
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      const typeLabel = issue.type === 'todo' ? '[To-do]' : '[Réserve]';
      doc.text(`${typeLabel} ${issue.title}`, margin + 10, y + 1);
      y += 5;

      // Assignee
      if (issue.assigneeSlug) {
        const assigneeName = assigneeMap.get(issue.assigneeSlug) || issue.assigneeSlug;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(55, 65, 81); // Darker gray for better visibility
        doc.text(`Assigné à : ${assigneeName}`, margin + 10, y + 1);
        y += 5;
      }

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
          const photoSize = 55;
          const photoGap = 4;
          const photosPerRow = Math.floor((contentWidth - 10 + photoGap) / (photoSize + photoGap));

          for (let i = 0; i < photos.length; i++) {
            if (y + photoSize > 275) {
              doc.addPage();
              y = margin;
              photoX = margin + 10;
            }

            try {
              const dataUrl = await blobToDataUrl(photos[i].blob);
              doc.addImage(dataUrl, 'JPEG', photoX, y, photoSize, photoSize);
              photoX += photoSize + photoGap;

              if ((i + 1) % photosPerRow === 0) {
                photoX = margin + 10;
                y += photoSize + photoGap;
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

  addPageNumbers(doc);
  doc.save('reserves.pdf');
}
