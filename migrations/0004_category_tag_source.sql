-- Task 12b: whether a category's English name was reviewed by hand or proposed by the model.

ALTER TABLE category_names ADD COLUMN tag_source TEXT NOT NULL DEFAULT 'model';
