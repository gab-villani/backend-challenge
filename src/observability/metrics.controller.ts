import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MetricsService } from './metrics.service.js';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  async metrics(@Res() res: Response): Promise<void> {
    const metrics = await this.metricsService.getMetrics();
    const contentType = await this.metricsService.getContentType();
    res.set('Content-Type', contentType);
    res.send(metrics);
  }
}