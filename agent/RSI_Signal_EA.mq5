//+------------------------------------------------------------------+
//|  RSI Signal EA - يكتب إشارات بدل ما يفتح صفقات مباشرة            |
//+------------------------------------------------------------------+
input int    RSI_Period  = 14;
input int    RSI_Buy     = 30;
input int    RSI_Sell    = 70;
input double LotSize     = 0.01;
input int    StopLoss    = 50;
input int    TakeProfit  = 100;
input string SignalFile  = "signals.json";  // اسم ملف الإشارات

int rsiHandle;
datetime lastBar;

//+------------------------------------------------------------------+
int OnInit()
  {
   rsiHandle = iRSI(_Symbol,_Period,RSI_Period,PRICE_CLOSE);
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void WriteSignal(string direction)
  {
   int handle = FileOpen(SignalFile, FILE_WRITE|FILE_TXT|FILE_COMMON);
   if(handle == INVALID_HANDLE) return;

   double ask = SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double point = SymbolInfoDouble(_Symbol,SYMBOL_POINT);

   double sl, tp, price;
   if(direction == "BUY")
     {
      price = ask;
      sl = ask - StopLoss * point * 10;
      tp = ask + TakeProfit * point * 10;
     }
   else
     {
      price = bid;
      sl = bid + StopLoss * point * 10;
      tp = bid - TakeProfit * point * 10;
     }

   string json = StringFormat(
      "{\"symbol\":\"%s\",\"direction\":\"%s\",\"price\":%.5f,\"sl\":%.5f,\"tp\":%.5f,\"volume\":%.2f,\"status\":\"pending\",\"time\":\"%s\"}",
      _Symbol, direction, price, sl, tp, LotSize, TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS)
   );

   FileWriteString(handle, json);
   FileClose(handle);

   Print("📤 إشارة مكتوبة: ", direction, " ", _Symbol);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   datetime currentBar = iTime(_Symbol,_Period,0);
   if(currentBar == lastBar) return;
   lastBar = currentBar;

   double rsi[2];
   if(CopyBuffer(rsiHandle,0,1,2,rsi) < 2) return;

   if(PositionsTotal() > 0) return;

   // شراء - RSI كان تحت 30 والحين طلع فوقه
   if(rsi[1] < RSI_Buy && rsi[0] > RSI_Buy)
     {
      WriteSignal("BUY");
     }

   // بيع - RSI كان فوق 70 والحين نزل تحته
   if(rsi[1] > RSI_Sell && rsi[0] < RSI_Sell)
     {
      WriteSignal("SELL");
     }
  }
//+------------------------------------------------------------------+
