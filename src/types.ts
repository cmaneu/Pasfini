// Data model types

export interface Room {
  slug: string;
  name: string;
}

export interface Assignee {
  slug: string;
  name: string;
}

export interface Issue {
  id: string;
  roomSlug: string;
  assigneeSlug?: string;
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
  { slug: 'entree', name: 'Entrée' },
  { slug: 'salle-de-bain-jaune', name: 'Salle de bain Jaune' },
  { slug: 'wc-etage', name: 'WC Etage' },
  { slug: 'couloir', name: 'Couloir' },
  { slug: 'suite-parentale', name: 'Suite parentale' },
  { slug: 'dressing-suite-parentale', name: 'Dressing suite parentale' },
  { slug: 'salle-deau-suite-parentale', name: 'Salle d\'eau suite parentale' },
  { slug: 'combles', name: 'Combles' },
  { slug: 'salle-deau-combles', name: 'Salle d\'eau combles' },
  { slug: 'salon', name: 'Salon' },
  { slug: 'salle-a-manger', name: 'Salle à manger' },
  { slug: 'cuisine', name: 'Cuisine' },
  { slug: 'buanderie', name: 'Buanderie' },
  { slug: 'garage', name: 'Garage' },
  { slug: 'exterieur', name: 'Extérieur' },
  { slug: 'wc-rdc', name: 'WC RDC' },
];

export const DEFAULT_ASSIGNEES: Assignee[] = [];
