-- Work request terms become structured: free-text `price` / `deadlineLabel` are
-- replaced by `money { amount, currency }` and `deadline { type, ... }`.
--
-- No table shape changes: terms still live in the JSONB columns
-- (`terms_json`, `proposed_terms_json`, `agreed_terms_json`) and the app is the
-- only writer. `parseTerms` in
-- `src/modules/marketplace/work-request-terms.ts` still reads the legacy shape,
-- so any row this migration cannot convert keeps rendering correctly — the
-- normalisation below is a convenience for existing (seed / backfilled) rows,
-- not a correctness requirement.
--
-- Conversion rules (identical to the TypeScript legacy path):
--   price          → money.amount = first number in the label, else money = null
--   currency       → money.currency, defaulting to SAR
--   deadlineLabel  → duration when the label is exactly "<n> day(s)|week(s)|month(s)",
--                    otherwise flexible (no dates are invented)
--   addons[].price → addons[].money

CREATE OR REPLACE FUNCTION "_mawahib_structured_terms"(terms jsonb) RETURNS jsonb AS $$
    SELECT CASE
        -- Nothing to do for NULLs, non-objects, or already-structured rows.
        WHEN terms IS NULL OR jsonb_typeof(terms) <> 'object' THEN terms
        WHEN terms ? 'money' AND terms ? 'deadline' THEN terms
        ELSE (terms - 'price' - 'currency' - 'deadlineLabel')
            || jsonb_build_object(
                'money',
                CASE
                    WHEN substring(replace(COALESCE(terms->>'price', ''), ',', '') from '[0-9]+(?:\.[0-9]+)?') IS NULL
                        THEN 'null'::jsonb
                    ELSE jsonb_build_object(
                        'amount',
                        substring(replace(terms->>'price', ',', '') from '[0-9]+(?:\.[0-9]+)?')::numeric,
                        'currency',
                        CASE
                            WHEN length(btrim(COALESCE(terms->>'currency', ''))) = 3
                                THEN upper(btrim(terms->>'currency'))
                            ELSE 'SAR'
                        END
                    )
                END,
                'deadline',
                CASE
                    WHEN COALESCE(terms->>'deadlineLabel', '') ~* '^[0-9]+\s*(day|days|week|weeks|month|months)$'
                        THEN jsonb_build_object(
                            'type', 'duration',
                            'durationValue',
                            substring(terms->>'deadlineLabel' from '[0-9]+')::int,
                            'durationUnit',
                            lower(substring(terms->>'deadlineLabel' from '(?i)(day|week|month)')) || 's'
                        )
                    ELSE jsonb_build_object('type', 'flexible')
                END
            )
            || CASE
                WHEN jsonb_typeof(terms->'addons') = 'array' THEN jsonb_build_object(
                    'addons',
                    COALESCE((
                        SELECT jsonb_agg(
                            (addon - 'price') || jsonb_build_object(
                                'money',
                                jsonb_build_object(
                                    'amount',
                                    COALESCE(
                                        substring(replace(COALESCE(addon->>'price', ''), ',', '') from '[0-9]+(?:\.[0-9]+)?')::numeric,
                                        0
                                    ),
                                    'currency',
                                    CASE
                                        WHEN length(btrim(COALESCE(terms->>'currency', ''))) = 3
                                            THEN upper(btrim(terms->>'currency'))
                                        ELSE 'SAR'
                                    END
                                )
                            )
                        )
                        FROM jsonb_array_elements(terms->'addons') AS addon
                        WHERE jsonb_typeof(addon) = 'object'
                    ), '[]'::jsonb)
                )
                ELSE '{}'::jsonb
            END
    END;
$$ LANGUAGE sql IMMUTABLE;

UPDATE "work_requests"
SET "terms_json" = "_mawahib_structured_terms"("terms_json"),
    "proposed_terms_json" = "_mawahib_structured_terms"("proposed_terms_json"),
    "agreed_terms_json" = "_mawahib_structured_terms"("agreed_terms_json")
WHERE ("terms_json" ? 'price' OR "terms_json" ? 'deadlineLabel')
   OR ("proposed_terms_json" ? 'price' OR "proposed_terms_json" ? 'deadlineLabel')
   OR ("agreed_terms_json" ? 'price' OR "agreed_terms_json" ? 'deadlineLabel');

DROP FUNCTION IF EXISTS "_mawahib_structured_terms"(jsonb);
