-- Share of Voice v2.5 : rang d'apparition et sentiment par marque dans l'historique
-- ranks      : { "Marque": 1, "Concurrent": 2, "Absente": null }
-- sentiments : { "Marque": { "label": "positive", "score": 0.8, "reason": "..." } }
alter table geo_runs add column if not exists ranks jsonb not null default '{}'::jsonb;
alter table geo_runs add column if not exists sentiments jsonb not null default '{}'::jsonb;
