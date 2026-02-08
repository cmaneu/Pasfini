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
  const photoFilenames = new Map<string, number>();

  // Collect all data for JSON and markdown
  const exportData = {
    exportDate: new Date().toISOString(),
    totalIssues: issues.length,
    openIssues: issues.filter((i) => i.status === 'open').length,
    doneIssues: issues.filter((i) => i.status === 'done').length,
    rooms: rooms,
    issues: [] as any[],
  };

  // Prepare markdown content
  let markdownContent = `# Réserves chantier — Pasfini\n\n`;
  markdownContent += `**Exporté le :** ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}\n\n`;
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

      markdownContent += `**Créée le :** ${new Date(issue.createdAt).toLocaleDateString('fr-FR')} à ${new Date(issue.createdAt).toLocaleTimeString('fr-FR')}\n\n`;
      markdownContent += `**Modifiée le :** ${new Date(issue.updatedAt).toLocaleDateString('fr-FR')} à ${new Date(issue.updatedAt).toLocaleTimeString('fr-FR')}\n\n`;

      // Fetch and add photos
      try {
        const photos = await getPhotosByIssue(issue.id);
        const photoRefs: string[] = [];

        if (photos.length > 0) {
          for (let i = 0; i < photos.length; i++) {
            const photo = photos[i];
            
            // Generate unique filename
            const extension = photo.mimeType.split('/')[1] || 'jpg';
            const baseFilename = `${issue.id}-${i + 1}`;
            let filename = `${baseFilename}.${extension}`;
            
            // Handle duplicate filenames
            const count = photoFilenames.get(filename) || 0;
            if (count > 0) {
              filename = `${baseFilename}-${count}.${extension}`;
            }
            photoFilenames.set(filename, count + 1);

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
        exportData.issues.push({
          id: issue.id,
          roomSlug: issue.roomSlug,
          roomName: roomName,
          title: issue.title,
          description: issue.description,
          status: issue.status,
          createdAt: new Date(issue.createdAt).toISOString(),
          updatedAt: new Date(issue.updatedAt).toISOString(),
          photoCount: photos.length,
          photos: photoRefs,
        });
      } catch (err) {
        console.error('Error processing photos for issue:', issue.id, err);
        markdownContent += `**Photos :** Erreur de chargement\n\n`;
        
        exportData.issues.push({
          id: issue.id,
          roomSlug: issue.roomSlug,
          roomName: roomName,
          title: issue.title,
          description: issue.description,
          status: issue.status,
          createdAt: new Date(issue.createdAt).toISOString(),
          updatedAt: new Date(issue.updatedAt).toISOString(),
          photoCount: 0,
          photos: [],
        });
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
  link.download = `pasfini-reserves-${new Date().toISOString().split('T')[0]}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
