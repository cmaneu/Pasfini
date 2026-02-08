// Data model types

export interface Room {
  slug: string;
  name: string;
}

export interface Issue {
  id: string;
  roomSlug: string;
  title: string;
  description: string;
  status: 'open' | 'done';
  createdAt: number;
  updatedAt: number;
  photos: string[]; // photo IDs
}

export interface PhotoRef {
  id: string;
  issueId: string;
  mimeType: string;
  width: number;
  height: number;
  createdAt: number;
  blob: Blob;
  thumbnailBlob: Blob;
}

export const DEFAULT_ROOMS: Room[] = [
  { slug: 'autre', name: 'Autre' },
  { slug: 'buanderie', name: 'Buanderie' },
  { slug: 'bureau', name: 'Bureau' },
  { slug: 'chambre-a-coucher', name: 'Chambre à coucher' },
  { slug: 'couloir', name: 'Couloir' },
  { slug: 'cuisine', name: 'Cuisine' },
  { slug: 'entree', name: 'Entrée' },
  { slug: 'exterieur', name: 'Extérieur' },
  { slug: 'salle-de-bain', name: 'Salle de bain' },
  { slug: 'salon-sejour', name: 'Salon / Séjour' },
  { slug: 'wc', name: 'WC' },
];
