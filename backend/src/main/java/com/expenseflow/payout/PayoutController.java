package com.expenseflow.payout;

import java.nio.charset.StandardCharsets;
import java.util.List;

import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.expenseflow.claim.dto.ClaimSummary;

/** Finance Head only (SecurityConfig). */
@RestController
@RequestMapping("/api/payouts")
public class PayoutController {

    private final PayoutService payoutService;

    public PayoutController(PayoutService payoutService) {
        this.payoutService = payoutService;
    }

    @GetMapping("/eligible")
    public List<ClaimSummary> eligible() {
        return payoutService.eligible();
    }

    @PostMapping
    public PayoutBatchDto create() {
        return payoutService.create();
    }

    @GetMapping
    public List<PayoutBatchDto> list() {
        return payoutService.list();
    }

    @GetMapping("/{id}/csv")
    public ResponseEntity<byte[]> csv(@PathVariable Long id) {
        CsvFile file = payoutService.exportCsv(id);
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(file.fileName()).build().toString())
                .body(file.content().getBytes(StandardCharsets.UTF_8));
    }

    @PostMapping("/{id}/mark-paid")
    public PayoutBatchDto markPaid(@PathVariable Long id) {
        return payoutService.markPaid(id);
    }
}
