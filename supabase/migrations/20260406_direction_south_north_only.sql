-- 기존 8방향을 남향 / 북향 으로 통일
-- Supabase SQL Editor에서 실행하거나: supabase db push

UPDATE properties
SET direction = CASE
  WHEN direction IN ('남향', '남동향', '남서향', '동향') THEN '남향'
  WHEN direction IN ('북향', '북동향', '북서향', '서향') THEN '북향'
  ELSE '남향'
END
WHERE direction IS NOT NULL;

-- NULL 은 남향으로 (또는 필요 시 '북향'으로 바꿔도 됨)
UPDATE properties
SET direction = '남향'
WHERE direction IS NULL;
