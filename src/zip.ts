// ZIP export functionality
import JSZip from 'jszip';
import type { Issue, Room } from './types.ts';
import { getPhotosByIssue } from './db.ts';

export async function exportZip(issues: Issue[], rooms: Room[]): Promise<void> {
  const zip = new JSZip();
  const roomMap = new Map(rooms.map((r) => [r.slug, r.name]));

  // Create img folder
  const imgFolder = zip.folder('img');
  if (!imgFolder) throw new Error('Failed to create img folder');

  // Track photo filenames to avoid duplicates
  const usedFilenames = new Set<string>();

  // Safe image extensions allowlist
  const SAFE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  const DEFAULT_EXTENSION = 'jpg';

  // Collect all data for JSON and markdown
  const exportDate = new Date();
  const exportData = {
    exportDate: exportDate.toISOString(),
    totalIssues: issues.length,
    openIssues: issues.filter((i) => i.status === 'open').length,
    doneIssues: issues.filter((i) => i.status === 'done').length,
    rooms: rooms,
    issues: [] as any[],
  };

  // Prepare markdown content
  let markdownContent = `# Réserves chantier — Pasfini\n\n`;
  markdownContent += `**Exporté le :** ${exportDate.toLocaleDateString('fr-FR')} à ${exportDate.toLocaleTimeString('fr-FR')}\n\n`;
  markdownContent += `**Total :** ${issues.length} réserve(s) — ${exportData.openIssues} ouverte(s), ${exportData.doneIssues} terminée(s)\n\n`;
  markdownContent += `---\n\n`;

  // Group issues by room
  const grouped = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = grouped.get(issue.roomSlug) || [];
    list.push(issue);
    grouped.set(issue.roomSlug, list);
  }

  // Sort rooms by name
  const sortedSlugs = [...grouped.keys()].sort((a, b) =>
    (roomMap.get(a) || a).localeCompare(roomMap.get(b) || b, 'fr')
  );

  // Helper function to create issue export data
  const createIssueExportData = (issue: Issue, roomName: string, photoRefs: string[]) => ({
    id: issue.id,
    roomSlug: issue.roomSlug,
    roomName: roomName,
    title: issue.title,
    description: issue.description,
    status: issue.status,
    createdAt: new Date(issue.createdAt).toISOString(),
    updatedAt: new Date(issue.updatedAt).toISOString(),
    photoCount: photoRefs.length,
    photos: photoRefs,
  });

  // Process each room
  for (const slug of sortedSlugs) {
    const roomIssues = grouped.get(slug)!;
    const roomName = roomMap.get(slug) || slug;

    markdownContent += `## ${roomName}\n\n`;

    for (const issue of roomIssues) {
      const statusIcon = issue.status === 'done' ? '✅' : '⏳';
      const statusText = issue.status === 'done' ? 'Terminée' : 'Ouverte';

      markdownContent += `### ${statusIcon} ${issue.title}\n\n`;
      markdownContent += `**Statut :** ${statusText}\n\n`;
      markdownContent += `**Pièce :** ${roomName}\n\n`;

      if (issue.description) {
        markdownContent += `**Description :**\n\n${issue.description}\n\n`;
      }

      const createdDate = new Date(issue.createdAt);
      const updatedDate = new Date(issue.updatedAt);
      markdownContent += `**Créée le :** ${createdDate.toLocaleDateString('fr-FR')} à ${createdDate.toLocaleTimeString('fr-FR')}\n\n`;
      markdownContent += `**Modifiée le :** ${updatedDate.toLocaleDateString('fr-FR')} à ${updatedDate.toLocaleTimeString('fr-FR')}\n\n`;

      // Fetch and add photos
      try {
        const photos = await getPhotosByIssue(issue.id);
        const photoRefs: string[] = [];

        if (photos.length > 0) {
          for (let i = 0; i < photos.length; i++) {
            const photo = photos[i];
            
            // Safely extract and validate file extension
            const mimeType = photo.mimeType || 'image/jpeg';
            let extension = DEFAULT_EXTENSION;
            if (mimeType.includes('/')) {
              const extractedExt = mimeType.split('/')[1].toLowerCase();
              if (SAFE_EXTENSIONS.includes(extractedExt)) {
                extension = extractedExt;
              }
            }
            
            // Generate unique filename
            const baseFilename = `${issue.id}-${i + 1}`;
            let filename = `${baseFilename}.${extension}`;
            let counter = 1;
            
            // Ensure filename is unique
            while (usedFilenames.has(filename)) {
              filename = `${baseFilename}-${counter}.${extension}`;
              counter++;
            }
            usedFilenames.add(filename);

            // Add photo to zip
            imgFolder.file(filename, photo.blob);
            photoRefs.push(`img/${filename}`);
          }

          markdownContent += `**Photos :** ${photos.length}\n\n`;
          for (const ref of photoRefs) {
            markdownContent += `![Photo](${ref})\n\n`;
          }
        } else {
          markdownContent += `**Photos :** Aucune\n\n`;
        }

        // Add to JSON data
        exportData.issues.push(createIssueExportData(issue, roomName, photoRefs));
      } catch (err) {
        console.error('Error processing photos for issue:', issue.id, err);
        markdownContent += `**Photos :** Erreur de chargement\n\n`;
        
        exportData.issues.push(createIssueExportData(issue, roomName, []));
      }

      markdownContent += `---\n\n`;
    }
  }

  // Add markdown file to zip
  zip.file('report.md', markdownContent);

  // Add JSON file to zip
  zip.file('report.json', JSON.stringify(exportData, null, 2));

  // Generate and download zip file
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pasfini-reserves-${exportDate.toISOString().split('T')[0]}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
