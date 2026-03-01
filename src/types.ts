// Data model types

export interface Room {
  slug: string;
  name: string;
  letter?: string;
}

export interface Assignee {
  slug: string;
  name: string;
}

export type IssueType = 'reserve' | 'todo';

export interface Issue {
  id: string;
  code?: string; // auto-generated code: "{RoomLetter}{Number}" e.g. "Z1", "Y3"
  roomSlug: string;
  assigneeSlug?: string;
  type?: IssueType; // 'reserve' (default) or 'todo' — optional for backward compatibility
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
  { slug: 'entree', name: 'Entrée', letter: 'Z' },
  { slug: 'salle-de-bain-jaune', name: 'Salle de bain Jaune', letter: 'Y' },
  { slug: 'wc-etage', name: 'WC Etage', letter: 'X' },
  { slug: 'couloir', name: 'Couloir', letter: 'W' },
  { slug: 'suite-parentale', name: 'Suite parentale', letter: 'V' },
  { slug: 'dressing-suite-parentale', name: 'Dressing suite parentale', letter: 'U' },
  { slug: 'salle-deau-suite-parentale', name: 'Salle d\'eau suite parentale', letter: 'T' },
  { slug: 'combles', name: 'Combles', letter: 'S' },
  { slug: 'salle-deau-combles', name: 'Salle d\'eau combles', letter: 'R' },
  { slug: 'salon', name: 'Salon', letter: 'Q' },
  { slug: 'salle-a-manger', name: 'Salle à manger', letter: 'P' },
  { slug: 'cuisine', name: 'Cuisine', letter: 'O' },
  { slug: 'buanderie', name: 'Buanderie', letter: 'N' },
  { slug: 'garage', name: 'Garage', letter: 'M' },
  { slug: 'exterieur', name: 'Extérieur', letter: 'L' },
  { slug: 'wc-rdc', name: 'WC RDC', letter: 'K' },
];

export const DEFAULT_ASSIGNEES: Assignee[] = [];
