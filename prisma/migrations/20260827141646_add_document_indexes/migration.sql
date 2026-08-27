-- CreateIndex
CREATE INDEX "documents_contractId_idx" ON "documents"("contractId");

-- CreateIndex
CREATE INDEX "documents_uploadedAt_idx" ON "documents"("uploadedAt");

-- CreateIndex
CREATE INDEX "home_item_documents_homeItemId_idx" ON "home_item_documents"("homeItemId");

-- CreateIndex
CREATE INDEX "home_item_documents_uploadedAt_idx" ON "home_item_documents"("uploadedAt");

-- CreateIndex
CREATE INDEX "inbox_documents_status_idx" ON "inbox_documents"("status");

-- CreateIndex
CREATE INDEX "inbox_documents_uploadedAt_idx" ON "inbox_documents"("uploadedAt");

-- CreateIndex
CREATE INDEX "inventory_item_documents_inventoryItemId_idx" ON "inventory_item_documents"("inventoryItemId");

-- CreateIndex
CREATE INDEX "inventory_item_documents_uploadedAt_idx" ON "inventory_item_documents"("uploadedAt");

-- CreateIndex
CREATE INDEX "product_documents_productId_idx" ON "product_documents"("productId");

-- CreateIndex
CREATE INDEX "product_documents_uploadedAt_idx" ON "product_documents"("uploadedAt");

-- CreateIndex
CREATE INDEX "rental_statement_documents_rentalStatementId_idx" ON "rental_statement_documents"("rentalStatementId");

-- CreateIndex
CREATE INDEX "rental_statement_documents_uploadedAt_idx" ON "rental_statement_documents"("uploadedAt");

-- CreateIndex
CREATE INDEX "trade_documents_tradeId_idx" ON "trade_documents"("tradeId");

-- CreateIndex
CREATE INDEX "trade_documents_uploadedAt_idx" ON "trade_documents"("uploadedAt");

-- CreateIndex
CREATE INDEX "trip_segment_documents_tripSegmentId_idx" ON "trip_segment_documents"("tripSegmentId");

-- CreateIndex
CREATE INDEX "trip_segment_documents_uploadedAt_idx" ON "trip_segment_documents"("uploadedAt");

-- CreateIndex
CREATE INDEX "vehicle_item_documents_vehicleItemId_idx" ON "vehicle_item_documents"("vehicleItemId");

-- CreateIndex
CREATE INDEX "vehicle_item_documents_uploadedAt_idx" ON "vehicle_item_documents"("uploadedAt");
