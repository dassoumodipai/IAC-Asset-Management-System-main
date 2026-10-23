BEGIN;
UPDATE reference_values SET active=false WHERE kind='CATEGORY' AND code IN ('IT Equipment','Electrical');
INSERT INTO reference_values(kind,code,label) VALUES
('CATEGORY','IT Hardware','IT Hardware'),('CATEGORY','Software License','Software License'),('CATEGORY','Office Equipment','Office Equipment'),('CATEGORY','Furniture','Furniture'),('CATEGORY','Clinical/Therapy Equipment','Clinical/Therapy Equipment'),('CATEGORY','Security & ELV','Security & ELV'),('CATEGORY','Vehicle','Vehicle'),('CATEGORY','Electrical Equipment','Electrical Equipment'),('CATEGORY','Kitchen Equipment','Kitchen Equipment'),('CATEGORY','Other','Other'),
('CONDITION','Excellent','Excellent'),('CONDITION','Damaged','Damaged'),('CONDITION','Not Working','Not Working'),('RISK','Critical','Critical') ON CONFLICT(kind,code) DO UPDATE SET active=true;
COMMIT;
