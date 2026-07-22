# Fastest Gold continuous backtest

This folder reproduces the core closed-bar entry logic from `agent/fastest_gold.mq5` on XAUUSDm M5 data. It keeps the last 30% of the dataset out of optimization and blocks automatic promotion unless the candidate passes the safety gate.

## Windows usage

Keep MT5 open, collect `XAUUSDm_M5.csv`, then run:

```powershell
pip install -r backtesting\fastest_gold\requirements.txt
$env:BACKTEST_DATA="C:\mq5-learning\data\XAUUSDm_M5.csv"
$env:BACKEND_URL="https://mq5-production.up.railway.app"
$env:API_KEY="your-api-key"
python backtesting\fastest_gold\XAUUSDm_fastest_gold_backtest.py
```

When `BACKEND_URL` and `API_KEY` are present, the summary is uploaded to `/api/backtest/result` and appears in the dashboard's `BACKTEST` tab. The endpoint only stores results; it never applies settings to MT5.

## Model boundaries

- Market entries are simulated from the next M5 open with the recorded spread.
- Intrabar SL/TP uses conservative ordering: if both hit in one candle, SL wins.
- USD estimates assume a standard 100 oz XAU contract and 0.5 lot.
- Basket pending-order fills and tick-level position management still require MT5 Strategy Tester validation.
