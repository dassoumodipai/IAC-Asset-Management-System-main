BEGIN;
ALTER TABLE asset_label_prints DROP CONSTRAINT asset_label_prints_layout_check;
ALTER TABLE asset_label_prints ADD CONSTRAINT asset_label_prints_layout_check
 CHECK(layout IN ('A4_40','A4_24','A4_14','THERMAL_50x25'));
COMMIT;
