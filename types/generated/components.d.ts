import type { Schema, Struct } from '@strapi/strapi';

export interface AudioBooksChapter extends Struct.ComponentSchema {
  collectionName: 'components_audio_books_chapters';
  info: {
    description: '';
    displayName: 'Chapter';
    icon: 'file';
  };
  attributes: {
    audio_file: Schema.Attribute.Media<'audios'>;
    audio_url: Schema.Attribute.String;
    duration: Schema.Attribute.String;
    title: Schema.Attribute.String;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'audio-books.chapter': AudioBooksChapter;
    }
  }
}
