select *
from recipe_0_raw_material_in raw_in
join recipe_0_raw_material_used  raw_used ON raw_used.process_order_sap3 = raw_in.process_order_sap3 AND raw_used.id=raw_in.id;


