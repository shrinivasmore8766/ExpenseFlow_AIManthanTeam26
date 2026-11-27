package com.expenseflow.claim;

import java.util.List;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.expenseflow.approval.ApprovalService;
import com.expenseflow.claim.dto.ClaimDetail;
import com.expenseflow.claim.dto.ClaimSummary;
import com.expenseflow.claim.dto.ClaimTitleRequest;
import com.expenseflow.claim.dto.LineRequest;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/claims")
public class ClaimController {

    private final ClaimService claimService;
    private final ApprovalService approvalService;

    public ClaimController(ClaimService claimService, ApprovalService approvalService) {
        this.claimService = claimService;
        this.approvalService = approvalService;
    }

    @GetMapping
    public List<ClaimSummary> list() {
        return claimService.listOwn();
    }

    @PostMapping
    public ClaimDetail create(@Valid @RequestBody ClaimTitleRequest request) {
        return claimService.create(request.title());
    }

    @GetMapping("/{id}")
    public ClaimDetail get(@PathVariable Long id) {
        return claimService.get(id);
    }

    @PutMapping("/{id}")
    public ClaimDetail update(@PathVariable Long id, @Valid @RequestBody ClaimTitleRequest request) {
        return claimService.updateTitle(id, request.title());
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        claimService.delete(id);
    }

    @PostMapping("/{id}/lines")
    public ClaimDetail addLine(@PathVariable Long id, @Valid @RequestBody LineRequest request) {
        return claimService.addLine(id, request);
    }

    @PutMapping("/{id}/lines/{lineId}")
    public ClaimDetail updateLine(@PathVariable Long id, @PathVariable Long lineId,
                                  @Valid @RequestBody LineRequest request) {
        return claimService.updateLine(id, lineId, request);
    }

    @DeleteMapping("/{id}/lines/{lineId}")
    public ClaimDetail deleteLine(@PathVariable Long id, @PathVariable Long lineId) {
        return claimService.deleteLine(id, lineId);
    }

    @PostMapping(path = "/{id}/lines/{lineId}/receipt", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ClaimDetail uploadReceipt(@PathVariable Long id, @PathVariable Long lineId,
                                     @RequestParam("file") MultipartFile file) {
        return claimService.uploadReceipt(id, lineId, file);
    }

    @GetMapping("/{id}/lines/{lineId}/receipt")
    public ResponseEntity<byte[]> receipt(@PathVariable Long id, @PathVariable Long lineId) {
        ReceiptFile file = claimService.receipt(id, lineId);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(file.contentType()))
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
                .header("X-Content-Type-Options", "nosniff")
                .body(file.bytes());
    }

    @PostMapping("/{id}/submit")
    public ClaimDetail submit(@PathVariable Long id) {
        return approvalService.submit(id);
    }
}
