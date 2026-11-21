import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AircraftPhoto as Photo } from '../../domain/aircraftPhotos.ts';
import { loadAircraftPhotos } from '../../services/aircraft.ts';
import { AirframePreview } from './AirframePreview.tsx';

interface AircraftPhotoProps {
  /** Type OACI de l'appareil (« B738 ») et catégorie ADS-B. */
  type: string | null;
  category: string | null;
}

/**
 * Illustration de la fiche d'un vol : une vraie photo du type d'appareil, sous
 * licence libre, avec son auteur et sa licence. Quand aucune photo libre n'existe
 * pour ce type — ou qu'elle ne charge pas —, la maquette en volume la remplace.
 */
export function AircraftPhoto({ type, category }: AircraftPhotoProps) {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<Record<string, Photo> | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void loadAircraftPhotos().then((table) => { if (current) setPhotos(table); });
    return () => { current = false; };
  }, []);

  // la photo est celle du type réellement annoncé : un gabarit de repli n'en a pas
  const photo = type ? photos?.[type] : undefined;
  if (!photo || broken === photo.url) return <AirframePreview type={type} category={category} />;

  return (
    <figure className="aircraft-photo">
      <img src={photo.url} alt={t('aircraft.photoAlt', { subject: photo.subject })} loading="lazy" onError={() => setBroken(photo.url)} />
      <figcaption>
        {t('aircraft.photoCredit')} · <a href={photo.page} target="_blank" rel="noreferrer">{photo.author}</a> · {photo.licence} · Wikimedia Commons
      </figcaption>
    </figure>
  );
}
