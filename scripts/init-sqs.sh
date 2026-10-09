#!/bin/bash
set -e

# Dead letter queues (FIFO)
awslocal sqs create-queue --queue-name wager-transactions-dlq.fifo --attributes FifoQueue=true
awslocal sqs create-queue --queue-name wagering-events-dlq.fifo --attributes FifoQueue=true

# Main queues (FIFO) with DLQ redrive policy (maxReceiveCount=5)
awslocal sqs create-queue --queue-name wager-transactions.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true,RedrivePolicy="{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:wager-transactions-dlq.fifo\",\"maxReceiveCount\":\"5\"}"

awslocal sqs create-queue --queue-name wagering-events.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true,RedrivePolicy="{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:wagering-events-dlq.fifo\",\"maxReceiveCount\":\"5\"}"

echo "SQS queues created successfully."
